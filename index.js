
import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import dotenv from "dotenv";
import multer from "multer";
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { testConnection, closePool } from "./src/config/database.js";
import * as supplierQueries from "./src/db/supplier-queries.js";
import * as priceListQueries from "./src/db/price-list-queries.js";
import * as inventoryQueries from "./src/db/inventory-queries.js";
import * as customerQueries from "./src/db/customer-queries.js";
import * as inventoryAnalytics from "./src/db/inventory-analytics.js";
import * as uploadHistoryQueries from "./src/db/upload-history-queries.js";
import { realtimeService } from "./src/services/realtime-service.js";
import { getUploadQueue, createPriceListUploadProcessor } from "./src/utils/upload-queue.js";
import aiRoutes from "./src/routes/ai.routes.js";
import analyticsRoutes from "./src/routes/analytics.routes.js";
import supplierRoutes from "./src/routes/supplier.routes.js";
import customerRoutes from "./src/routes/customer.routes.js";
import supplierPurchaseOrderRoutes from "./src/routes/supplier-purchase-orders.routes.js";
import purchaseOrderRoutes from "./src/routes/purchase-orders.routes.js";
import supplyChainIntegrationRoutes from "./src/routes/supply-chain-integration.routes.js";
import invoiceRoutes from "./src/routes/invoice.routes.js";
import performanceMonitoringRoutes from "./src/routes/performance-monitoring.routes.js";
import authRoutes from "./src/routes/auth.routes.js";

// Migrated routes from unified-extractor
import wooCommerceIntegrationRoutes from "./src/routes/woocommerce-integration.routes.js";
import wooCommerceSyncRoutes from "./src/routes/woocommerce-sync.routes.js";
import dataImportRoutes from "./src/routes/data-import.routes.js";
import supplyChainExtractRoutes from "./src/routes/supply-chain-extract.routes.js";
import { analyticsService } from "./src/services/analytics.service.js";
import { integrationMonitoringService } from "./src/services/integration-monitoring.service.js";
import materializedViewRefreshService from "./src/services/materialized-view-refresh.service.js";
import queryOptimizationService from "./src/services/query-optimization.service.js";
import backgroundServiceOrchestrator from "./src/services/background-service-orchestrator.service.js";

// Import performance and security middleware
import { performanceMiddleware } from "./src/middleware/performance.wrapper.js";
import { securityMiddleware } from "./src/middleware/security.wrapper.js";
import {
  performanceMonitoring,
  compressionMiddleware,
  responseCaching,
  requestTimeout,
  memoryMonitoring,
  queryOptimization,
  performanceErrorHandler
} from "./src/middleware/performance.middleware.js";
import {
  securityHeaders,
  advancedRateLimiting,
  progressiveSlowdown,
  sqlInjectionProtection,
  xssProtection,
  requestSizeLimit,
  requestFingerprinting
} from "./src/middleware/security.middleware.js";
import { requestDeduplication } from "./src/middleware/request-deduplication.middleware.js";
import cacheService from "./src/services/cache.service.js";
import { securityConfig } from "./src/config/security.config.js";
import { protect } from "./src/middleware/auth.middleware.js";
import rbacMiddleware, { authenticateToken as rbacAuthenticateToken, requirePermission, requireRole, getKey } from "./src/middleware/rbac.middleware.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

// CORS configuration is handled comprehensively below

// Initialize cache service function
async function initializeCache() {
  const connected = await cacheService.connect();
  if (connected) {
    console.log('Cache service initialized successfully');
  } else {
    console.warn('Cache service initialization failed - running without cache');
  }
}

// Apply security middleware first - using wrapper functions
app.use(performanceMiddleware.compression());
app.use(performanceMiddleware.responseCache());
app.use(performanceMiddleware.responseTime());
app.use(securityMiddleware.helmet());
app.use(securityMiddleware.rateLimiter());

// Apply additional security middleware
app.use(securityHeaders);
app.use(requestFingerprinting);
app.use(requestSizeLimit(10 * 1024 * 1024)); // 10MB max request size

// Apply compression middleware
app.use(compressionMiddleware);

// Apply CORS configuration with proper settings
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : ['http://localhost:3000', 'http://localhost:3001'];
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Apply performance middleware
app.use(performanceMonitoring());
app.use(memoryMonitoring());
app.use(queryOptimization());
app.use(requestTimeout(30000)); // 30 second timeout

// Apply security validation middleware
app.use(sqlInjectionProtection);
app.use(xssProtection);

// Apply rate limiting based on endpoint type
app.use('/api/auth', advancedRateLimiting.auth);
app.use('/api/*/upload', advancedRateLimiting.upload);
app.use('/api/analytics', advancedRateLimiting.analytics);
app.use('/api', advancedRateLimiting.api);

// Apply progressive slowdown for all endpoints
app.use(progressiveSlowdown);

// Apply request deduplication for modifying requests
app.use(requestDeduplication({
  methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
  ttl: 5000, // 5 seconds
  skipPaths: ['/api/health', '/api/realtime', '/api/auth'],
  useCache: true
}));

// Apply response caching for GET requests
app.use(responseCaching(300)); // 5 minute cache TTL

// Health check endpoint
app.get('/health', (req, res) => {
  const orchestratorStatus = backgroundServiceOrchestrator.getStatus();
  const memUsage = process.memoryUsage();
  const memUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
  
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'NXT NEW DAY Backend',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    systemLoad: {
      memoryUsage: `${memUsagePercent.toFixed(1)}%`,
      heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`
    },
    backgroundServices: orchestratorStatus
  });
});

// Simple test endpoint
app.get('/test', (req, res) => {
  res.status(200).json({
    message: 'Backend is working!',
    timestamp: new Date().toISOString()
  });
});

// Background service orchestrator status endpoint
app.get('/api/system/background-services', authenticateToken, (req, res) => {
  const status = backgroundServiceOrchestrator.getStatus();
  res.json(status);
});

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Import improved authentication system
import { authConfig } from './src/config/auth.config.js';

// Initialize authentication system
let authMiddleware = null;

async function initializeAuth() {
  try {
    await authConfig.initialize();
    authMiddleware = authConfig.getAuthMiddleware({ bypassInDev: true });
    console.log('✅ Authentication system ready');
    
    // Log authentication status for debugging
    const authStatus = authConfig.getAuthStatus();
    console.log('🔍 Auth Status:', {
      mode: authStatus.authMode,
      stackAuth: authStatus.stackAuthConfigured ? '✅' : '❌',
      environment: authStatus.environment
    });
    
  } catch (error) {
    console.error('❌ Authentication initialization failed:', error);
    // Fallback to development bypass in non-production
    if (process.env.NODE_ENV !== 'production') {
      const { devAuthBypass } = await import('./src/middleware/auth-bypass.middleware.js');
      authMiddleware = devAuthBypass({ roles: ['admin'] });
      console.warn('⚠️ Using emergency development bypass');
    } else {
      throw error;
    }
  }
}

// Legacy authentication function (keeping for compatibility)
async function authenticateToken(req, res, next) {
  if (authMiddleware) {
    return authMiddleware(req, res, next);
  }
  
  // Fallback error if auth not initialized
  return res.status(500).json({
    success: false,
    error: 'Authentication system not initialized',
    code: 'AUTH_NOT_READY',
    timestamp: new Date().toISOString()
  });
}


// Mount supplier routes with authentication
app.use("/api/suppliers", protect, supplierRoutes);

// Mount customer routes with authentication
app.use("/api/customers", protect, customerRoutes);

// Mount supplier purchase order routes with authentication
app.use("/api/supplier-purchase-orders", protect, supplierPurchaseOrderRoutes);

// Mount purchase order routes with authentication
app.use("/api/purchase-orders", protect, purchaseOrderRoutes);

// Mount supply chain integration routes with authentication
app.use("/api/supply-chain", protect, supplyChainIntegrationRoutes);

// Mount invoice routes with authentication
app.use("/api/invoices", protect, invoiceRoutes);

// Mount performance monitoring routes with authentication
app.use("/api/monitoring", protect, performanceMonitoringRoutes);

// Mount auth routes
app.use("/api/auth", authRoutes);

// Migrated routes from unified-extractor
app.use("/api/woocommerce", protect, wooCommerceIntegrationRoutes);
app.use("/api/woocommerce-sync", wooCommerceSyncRoutes); // Enhanced bidirectional sync
app.use("/api/data-import", protect, dataImportRoutes);
app.use("/api/supply-chain-extract", protect, supplyChainExtractRoutes);

// Legacy price list routes (will be deprecated in favor of supplier-scoped routes)
// These are kept for backward compatibility but new implementations should use /api/suppliers/:id/price-lists

// Get all price lists (legacy)
app.get("/api/price-lists", authenticateToken, async (req, res) => {
  try {
    const params = {
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 10,
      supplierId: req.query.supplierId || null,
      status: req.query.status || null,
      isActive: req.query.isActive === 'true' ? true : req.query.isActive === 'false' ? false : null,
      sortBy: req.query.sortBy || 'createdAt',
      sortOrder: req.query.sortOrder || 'desc'
    };
    
    const result = await priceListQueries.getPriceLists(params);
    res.json(result);
  } catch (err) {
    console.error('Error fetching price lists:', err);
    res.status(500).json({ error: 'Failed to fetch price lists' });
  }
});

// Get price list by ID (legacy)
app.get("/api/price-lists/:id", authenticateToken, async (req, res) => {
  try {
    const priceList = await priceListQueries.getPriceListById(req.params.id);
    if (!priceList) {
      return res.status(404).json({ error: 'Price list not found' });
    }
    res.json(priceList);
  } catch (err) {
    console.error('Error fetching price list:', err);
    res.status(500).json({ error: 'Failed to fetch price list' });
  }
});

// Download price list template (legacy)
app.get("/api/price-lists/template/:format", authenticateToken, async (req, res) => {
  try {
    const format = req.params.format.toUpperCase();
    
    // Import file parser dynamically
    const { generatePriceListTemplate, SUPPORTED_FILE_TYPES } = 
      await import('./src/utils/file-parsers/index.js');
    
    if (!SUPPORTED_FILE_TYPES[format] || !SUPPORTED_FILE_TYPES[format].templateGenerator) {
      return res.status(400).json({ 
        error: `Template not available for ${format} format` 
      });
    }

    const template = generatePriceListTemplate(format);
    
    // Set appropriate headers
    const config = SUPPORTED_FILE_TYPES[format];
    const extension = config.extensions[0];
    const mimeType = config.mimeTypes[0];
    
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="price-list-template${extension}"`);
    
    // Send the template
    if (format === 'CSV') {
      res.send(template);
    } else {
      res.send(Buffer.from(template));
    }
  } catch (err) {
    console.error('Error generating template:', err);
    res.status(500).json({ error: 'Failed to generate template' });
  }
});

// Approve price list (legacy)
app.put("/api/price-lists/:id/approve", authenticateToken, async (req, res) => {
  try {
    const priceList = await priceListQueries.updatePriceListStatus(
      req.params.id, 
      'approved', 
      req.user.sub // User ID from JWT
    );
    if (!priceList) {
      return res.status(404).json({ error: 'Price list not found' });
    }
    res.json(priceList);
  } catch (err) {
    console.error('Error approving price list:', err);
    res.status(500).json({ error: 'Failed to approve price list' });
  }
});

// Activate price list (legacy)
app.put("/api/price-lists/:id/activate", authenticateToken, async (req, res) => {
  try {
    const priceList = await priceListQueries.activatePriceList(req.params.id);
    res.json(priceList);
  } catch (err) {
    console.error('Error activating price list:', err);
    res.status(500).json({ error: err.message || 'Failed to activate price list' });
  }
});

// ==================== INVENTORY ROUTES ====================

// Get inventory with filters and pagination
app.get("/api/inventory", authenticateToken, async (req, res) => {
  try {
    const params = {
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 10,
      search: req.query.search || '',
      warehouseId: req.query.warehouseId || null,
      stockStatus: req.query.stockStatus || null,
      belowReorderPoint: req.query.belowReorderPoint === 'true',
      sortBy: req.query.sortBy || 'createdAt',
      sortOrder: req.query.sortOrder || 'desc'
    };
    
    const result = await inventoryQueries.getInventory(params);
    res.json(result);
  } catch (err) {
    console.error('Error fetching inventory:', err);
    res.status(500).json({ error: 'Failed to fetch inventory' });
  }
});

// Get single inventory record by ID
app.get("/api/inventory/:id", authenticateToken, async (req, res) => {
  try {
    const inventory = await inventoryQueries.getInventoryById(parseInt(req.params.id));
    if (!inventory) {
      return res.status(404).json({ error: 'Inventory record not found' });
    }
    res.json(inventory);
  } catch (err) {
    console.error('Error fetching inventory record:', err);
    res.status(500).json({ error: 'Failed to fetch inventory record' });
  }
});

// Create or update inventory record
app.post("/api/inventory", authenticateToken, async (req, res) => {
  try {
    const inventory = await inventoryQueries.upsertInventory(req.body);
    res.status(201).json(inventory);
  } catch (err) {
    console.error('Error creating/updating inventory:', err);
    res.status(500).json({ error: 'Failed to create/update inventory' });
  }
});

// Record inventory movement
app.post("/api/inventory/movements", authenticateToken, async (req, res) => {
  try {
    const movementData = {
      ...req.body,
      performedBy: req.user.sub // User ID from JWT
    };
    const result = await inventoryQueries.recordMovement(movementData);
    res.status(201).json(result);
  } catch (err) {
    console.error('Error recording movement:', err);
    res.status(500).json({ error: err.message || 'Failed to record movement' });
  }
});

// Stock adjustment
app.put("/api/inventory/:id/adjust", authenticateToken, async (req, res) => {
  try {
    const { newQuantity, reason, notes } = req.body;
    if (typeof newQuantity !== 'number' || !reason) {
      return res.status(400).json({ error: 'newQuantity and reason are required' });
    }
    
    const result = await inventoryQueries.adjustStock(
      parseInt(req.params.id),
      newQuantity,
      reason,
      req.user.sub,
      notes
    );
    res.json(result);
  } catch (err) {
    console.error('Error adjusting stock:', err);
    res.status(500).json({ error: err.message || 'Failed to adjust stock' });
  }
});

// Reserve stock
app.post("/api/inventory/:productId/reserve", authenticateToken, async (req, res) => {
  try {
    const { warehouseId, quantity } = req.body;
    if (!warehouseId || !quantity) {
      return res.status(400).json({ error: 'warehouseId and quantity are required' });
    }
    
    const result = await inventoryQueries.reserveStock(
      req.params.productId,
      warehouseId,
      quantity
    );
    res.json(result);
  } catch (err) {
    console.error('Error reserving stock:', err);
    res.status(500).json({ error: err.message || 'Failed to reserve stock' });
  }
});

// Release reserved stock
app.post("/api/inventory/:productId/release", authenticateToken, async (req, res) => {
  try {
    const { warehouseId, quantity } = req.body;
    if (!warehouseId || !quantity) {
      return res.status(400).json({ error: 'warehouseId and quantity are required' });
    }
    
    const result = await inventoryQueries.releaseReservedStock(
      req.params.productId,
      warehouseId,
      quantity
    );
    res.json(result);
  } catch (err) {
    console.error('Error releasing reserved stock:', err);
    res.status(500).json({ error: err.message || 'Failed to release reserved stock' });
  }
});

// Get inventory movements
app.get("/api/inventory/movements", authenticateToken, async (req, res) => {
  try {
    const params = {
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 10,
      inventoryId: req.query.inventoryId ? parseInt(req.query.inventoryId) : null,
      productId: req.query.productId || null,
      warehouseId: req.query.warehouseId || null,
      movementType: req.query.movementType || null,
      dateFrom: req.query.dateFrom || null,
      dateTo: req.query.dateTo || null,
      sortBy: req.query.sortBy || 'createdAt',
      sortOrder: req.query.sortOrder || 'desc'
    };
    
    const result = await inventoryQueries.getMovements(params);
    res.json(result);
  } catch (err) {
    console.error('Error fetching movements:', err);
    res.status(500).json({ error: 'Failed to fetch movements' });
  }
});

// Get reorder suggestions
app.get("/api/inventory/reorder", authenticateToken, async (req, res) => {
  try {
    const suggestions = await inventoryQueries.getReorderSuggestions();
    res.json(suggestions);
  } catch (err) {
    console.error('Error fetching reorder suggestions:', err);
    res.status(500).json({ error: 'Failed to fetch reorder suggestions' });
  }
});

// Get inventory analytics
app.get("/api/inventory/analytics", authenticateToken, async (req, res) => {
  try {
    const params = {
      warehouseId: req.query.warehouseId || null,
      categoryFilter: req.query.categoryFilter || null
    };
    
    const analytics = await inventoryQueries.getInventoryAnalytics(params);
    res.json(analytics);
  } catch (err) {
    console.error('Error fetching inventory analytics:', err);
    res.status(500).json({ error: 'Failed to fetch inventory analytics' });
  }
});

// ==================== INVENTORY ANALYTICS ROUTES ====================

// Get inventory turnover analysis
app.get("/api/analytics/inventory/turnover", authenticateToken, async (req, res) => {
  try {
    const params = {
      warehouseId: req.query.warehouseId || null,
      categoryFilter: req.query.categoryFilter || null,
      dateFrom: req.query.dateFrom || null,
      dateTo: req.query.dateTo || null,
      productId: req.query.productId || null,
      groupBy: req.query.groupBy || 'product', // product, category, warehouse, all
      includeTrends: req.query.includeTrends === 'true'
    };

    let result = {};

    // Get turnover analysis
    const turnoverData = await inventoryAnalytics.calculateInventoryTurnover(params);
    result.turnover = turnoverData;

    // Include trends if requested
    if (params.includeTrends) {
      const trendsParams = {
        warehouseId: params.warehouseId,
        categoryFilter: params.categoryFilter,
        productId: params.productId,
        periodType: req.query.periodType || 'monthly',
        periodsBack: parseInt(req.query.periodsBack) || 12
      };
      const trends = await inventoryAnalytics.getInventoryTurnoverTrends(trendsParams);
      result.trends = trends;
    }

    // Calculate summary statistics
    const summary = {
      totalItems: turnoverData.length,
      avgTurnoverRatio: turnoverData.length > 0 ? 
        Number((turnoverData.reduce((sum, item) => sum + item.turnoverRatio, 0) / turnoverData.length).toFixed(2)) : 0,
      avgDaysOfInventory: turnoverData.length > 0 ? 
        Math.round(turnoverData.reduce((sum, item) => sum + item.daysOfInventory, 0) / turnoverData.length) : 0,
      totalInventoryValue: turnoverData.reduce((sum, item) => sum + item.currentInventoryValue, 0),
      totalCOGS: turnoverData.reduce((sum, item) => sum + item.cogsTotal, 0),
      healthDistribution: {
        excellent: turnoverData.filter(item => item.turnoverHealth === 'excellent').length,
        good: turnoverData.filter(item => item.turnoverHealth === 'good').length,
        fair: turnoverData.filter(item => item.turnoverHealth === 'fair').length,
        poor: turnoverData.filter(item => item.turnoverHealth === 'poor').length,
        critical: turnoverData.filter(item => item.turnoverHealth === 'critical').length,
      }
    };

    result.summary = summary;
    result.analysisDate = new Date().toISOString();
    result.parameters = params;

    res.json(result);
  } catch (err) {
    console.error('Error fetching inventory turnover analytics:', err);
    res.status(500).json({ error: 'Failed to fetch inventory turnover analytics' });
  }
});

// Get inventory optimization recommendations
app.get("/api/analytics/inventory/optimization", authenticateToken, async (req, res) => {
  try {
    const params = {
      warehouseId: req.query.warehouseId || null,
      productId: req.query.productId || null,
      analysisMethod: req.query.analysisMethod || 'economic_order_quantity',
      lookbackDays: parseInt(req.query.lookbackDays) || 90,
      serviceLevel: parseFloat(req.query.serviceLevel) || 0.95,
      leadTimeDays: parseInt(req.query.leadTimeDays) || 7,
      includeABC: req.query.includeABC === 'true'
    };

    let result = {};

    // Get stock level optimization
    const optimizationData = await inventoryAnalytics.calculateOptimalStockLevels(params);
    result.optimization = optimizationData;

    // Include ABC analysis if requested
    if (params.includeABC) {
      const abcParams = {
        warehouseId: params.warehouseId,
        lookbackDays: params.lookbackDays,
        criteriaType: req.query.abcCriteria || 'revenue'
      };
      const abcAnalysis = await inventoryAnalytics.performABCAnalysis(abcParams);
      result.abcAnalysis = abcAnalysis;
    }

    // Get reorder point optimization
    const reorderParams = {
      warehouseId: params.warehouseId,
      productId: params.productId,
      serviceLevel: params.serviceLevel,
      leadTimeDays: params.leadTimeDays,
      lookbackDays: params.lookbackDays,
      method: req.query.reorderMethod || 'statistical'
    };
    const reorderOptimization = await inventoryAnalytics.calculateOptimizedReorderPoints(reorderParams);
    result.reorderOptimization = reorderOptimization;

    // Calculate optimization summary
    const optimizationSummary = {
      totalItems: optimizationData.length,
      potentialSavings: optimizationData.reduce((sum, item) => sum + item.potentialSavings, 0),
      avgImprovementPercentage: optimizationData.length > 0 ? 
        Number((optimizationData.reduce((sum, item) => sum + item.improvementPercentage, 0) / optimizationData.length).toFixed(1)) : 0,
      recommendationDistribution: {
        reduce_stock: optimizationData.filter(item => item.recommendation === 'reduce_stock').length,
        increase_stock: optimizationData.filter(item => item.recommendation === 'increase_stock').length,
        optimize_reorder_point: optimizationData.filter(item => item.recommendation === 'optimize_reorder_point').length,
        maintain_current: optimizationData.filter(item => item.recommendation === 'maintain_current').length,
      },
      highPriorityItems: reorderOptimization.filter(item => item.priority === 'high').length,
    };

    result.summary = optimizationSummary;
    result.analysisDate = new Date().toISOString();
    result.parameters = params;

    res.json(result);
  } catch (err) {
    console.error('Error fetching inventory optimization analytics:', err);
    res.status(500).json({ error: 'Failed to fetch inventory optimization analytics' });
  }
});

// Get inventory alerts and warnings
app.get("/api/analytics/inventory/alerts", authenticateToken, async (req, res) => {
  try {
    const params = {
      warehouseId: req.query.warehouseId || null,
      categoryFilter: req.query.categoryFilter || null,
      deadStockDays: parseInt(req.query.deadStockDays) || 180,
      slowMovingDays: parseInt(req.query.slowMovingDays) || 90,
      minQuantityThreshold: parseInt(req.query.minQuantityThreshold) || 1,
      includeSlowMoving: req.query.includeSlowMoving !== 'false',
      alertTypes: req.query.alertTypes ? req.query.alertTypes.split(',') : ['dead_stock', 'reorder', 'overstock']
    };

    let result = {
      alerts: [],
      summary: {},
      analysisDate: new Date().toISOString(),
      parameters: params
    };

    // Dead stock and slow-moving analysis
    if (params.alertTypes.includes('dead_stock')) {
      const deadStockData = await inventoryAnalytics.identifyDeadStock({
        warehouseId: params.warehouseId,
        categoryFilter: params.categoryFilter,
        deadStockDays: params.deadStockDays,
        slowMovingDays: params.slowMovingDays,
        minQuantityThreshold: params.minQuantityThreshold,
        includeSlowMoving: params.includeSlowMoving
      });

      // Convert dead stock items to alerts
      deadStockData.items.forEach(item => {
        result.alerts.push({
          type: item.stockStatus === 'dead' ? 'dead_stock' : 'slow_moving',
          severity: item.riskLevel,
          productId: item.productId,
          productSku: item.productSku,
          productName: item.productName,
          warehouseId: item.warehouseId,
          message: `${item.productName} (${item.productSku}): ${item.reason}`,
          details: {
            quantityOnHand: item.quantityOnHand,
            inventoryValue: item.inventoryValue,
            daysWithoutSale: item.daysWithoutSale,
            daysOfInventory: item.daysOfInventory,
            recommendations: item.recommendations
          },
          createdAt: new Date().toISOString()
        });
      });

      result.deadStockSummary = deadStockData.summary;
    }

    // Reorder point alerts
    if (params.alertTypes.includes('reorder')) {
      const reorderSuggestions = await inventoryQueries.getReorderSuggestions();
      
      reorderSuggestions.forEach(item => {
        const urgency = item.quantityAvailable <= 0 ? 'critical' : 
                      item.quantityAvailable <= (item.reorderPoint * 0.5) ? 'high' : 'medium';
        
        result.alerts.push({
          type: 'reorder_needed',
          severity: urgency,
          productId: item.productId,
          productSku: item.productSku,
          productName: item.productName,
          warehouseId: item.warehouseId,
          message: `${item.productName} (${item.productSku}) needs reordering - Stock: ${item.quantityAvailable}, Reorder Point: ${item.reorderPoint}`,
          details: {
            quantityAvailable: item.quantityAvailable,
            reorderPoint: item.reorderPoint,
            reorderQuantity: item.reorderQuantity,
            supplierName: item.supplierName,
            supplierId: item.supplierId
          },
          createdAt: new Date().toISOString()
        });
      });
    }

    // Overstock alerts (using optimization data)
    if (params.alertTypes.includes('overstock')) {
      const optimizationData = await inventoryAnalytics.calculateOptimalStockLevels({
        warehouseId: params.warehouseId,
        lookbackDays: 90
      });

      optimizationData
        .filter(item => item.recommendation === 'reduce_stock')
        .forEach(item => {
          result.alerts.push({
            type: 'overstock',
            severity: item.potentialSavings > 1000 ? 'high' : 'medium',
            productId: item.productId,
            productSku: item.productSku,
            productName: item.productName,
            warehouseId: item.warehouseId,
            message: `${item.productName} (${item.productSku}) is overstocked - potential savings: $${item.potentialSavings}`,
            details: {
              currentStock: item.currentStock,
              optimizedReorderPoint: item.optimizedReorderPoint,
              potentialSavings: item.potentialSavings,
              improvementPercentage: item.improvementPercentage
            },
            createdAt: new Date().toISOString()
          });
        });
    }

    // Sort alerts by severity and potential impact
    result.alerts.sort((a, b) => {
      const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      const severityDiff = severityOrder[b.severity] - severityOrder[a.severity];
      if (severityDiff !== 0) return severityDiff;
      
      // Secondary sort by value impact
      const aValue = a.details.inventoryValue || a.details.potentialSavings || 0;
      const bValue = b.details.inventoryValue || b.details.potentialSavings || 0;
      return bValue - aValue;
    });

    // Calculate summary statistics
    result.summary = {
      totalAlerts: result.alerts.length,
      alertsByType: {
        dead_stock: result.alerts.filter(a => a.type === 'dead_stock').length,
        slow_moving: result.alerts.filter(a => a.type === 'slow_moving').length,
        reorder_needed: result.alerts.filter(a => a.type === 'reorder_needed').length,
        overstock: result.alerts.filter(a => a.type === 'overstock').length,
      },
      alertsBySeverity: {
        critical: result.alerts.filter(a => a.severity === 'critical').length,
        high: result.alerts.filter(a => a.severity === 'high').length,
        medium: result.alerts.filter(a => a.severity === 'medium').length,
        low: result.alerts.filter(a => a.severity === 'low').length,
      },
      totalValueAtRisk: result.alerts
        .filter(a => a.type === 'dead_stock' || a.type === 'slow_moving')
        .reduce((sum, alert) => sum + (alert.details.inventoryValue || 0), 0),
      totalPotentialSavings: result.alerts
        .filter(a => a.type === 'overstock')
        .reduce((sum, alert) => sum + (alert.details.potentialSavings || 0), 0),
    };

    res.json(result);
  } catch (err) {
    console.error('Error fetching inventory alerts:', err);
    res.status(500).json({ error: 'Failed to fetch inventory alerts' });
  }
});

// Get advanced inventory analytics
app.get("/api/inventory/analytics/advanced", authenticateToken, async (req, res) => {
  try {
    const params = {
      warehouseId: req.query.warehouseId || null,
      categoryFilter: req.query.categoryFilter || null,
      dateFrom: req.query.dateFrom || null,
      dateTo: req.query.dateTo || null,
      analysisType: req.query.analysisType || 'all'
    };
    
    const analytics = await inventoryQueries.getAdvancedInventoryAnalytics(params);
    res.json(analytics);
  } catch (err) {
    console.error('Error fetching advanced inventory analytics:', err);
    res.status(500).json({ error: 'Failed to fetch advanced inventory analytics' });
  }
});

// ==================== CUSTOMER ROUTES ====================

// Process customer sale
app.post("/api/customers/:id/sales", authenticateToken, async (req, res) => {
  try {
    const saleData = {
      ...req.body,
      customerId: req.params.id,
      performedBy: req.user.sub
    };
    const result = await customerQueries.processSale(saleData);
    res.status(201).json({
      success: true,
      ...result,
      message: 'Sale processed successfully'
    });
  } catch (err) {
    console.error('Error processing sale:', err);
    res.status(500).json({ error: err.message || 'Failed to process sale' });
  }
});

// Reserve stock for customer
app.post("/api/customers/:id/reserve", authenticateToken, async (req, res) => {
  try {
    const { items } = req.body;
    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'items array is required' });
    }
    
    const reservations = await customerQueries.reserveStockForCustomer(req.params.id, items);
    res.status(201).json({
      success: true,
      reservations,
      message: 'Stock reserved successfully'
    });
  } catch (err) {
    console.error('Error reserving stock:', err);
    res.status(500).json({ error: err.message || 'Failed to reserve stock' });
  }
});

// Release customer reservation
app.post("/api/customers/:id/release", authenticateToken, async (req, res) => {
  try {
    const { items } = req.body;
    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'items array is required' });
    }
    
    const releases = await customerQueries.releaseCustomerReservation(req.params.id, items);
    res.status(200).json({
      success: true,
      releases,
      message: 'Reservations released successfully'
    });
  } catch (err) {
    console.error('Error releasing reservations:', err);
    res.status(500).json({ error: err.message || 'Failed to release reservations' });
  }
});

// Get customer sales velocity
app.get("/api/customers/:id/sales-velocity", authenticateToken, async (req, res) => {
  try {
    const params = {
      dateFrom: req.query.dateFrom || null,
      dateTo: req.query.dateTo || null,
      productId: req.query.productId || null
    };
    
    const velocity = await customerQueries.getCustomerSalesVelocity(req.params.id, params);
    res.json(velocity);
  } catch (err) {
    console.error('Error fetching customer sales velocity:', err);
    res.status(500).json({ error: 'Failed to fetch customer sales velocity' });
  }
});

// Get customer backorders
app.get("/api/customers/:id/backorders", authenticateToken, async (req, res) => {
  try {
    const backorders = await customerQueries.getCustomerBackorders(req.params.id);
    res.json(backorders);
  } catch (err) {
    console.error('Error fetching customer backorders:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch customer backorders' });
  }
});

// Customer analytics routes have been moved to /src/routes/analytics.routes.js

// ==================== AI INTEGRATION ROUTES ====================

// Mount analytics routes with authentication (general analytics endpoints)
app.use("/api/analytics", authenticateToken, analyticsRoutes);

// Mount AI analytics routes with authentication (specific AI endpoints)
app.use("/api/analytics/ai", authenticateToken, aiRoutes);

// Real-time WebSocket endpoint for inventory updates
app.get("/api/realtime/stats", authenticateToken, (req, res) => {
  const stats = realtimeService.getConnectionStats();
  res.json(stats);
});

// Add performance error handler at the end of middleware chain
app.use(performanceErrorHandler());

// Server startup with WebSocket support
async function startServer() {
  try {
    // Test database connection
    const dbConnected = await testConnection();
    if (!dbConnected) {
      throw new Error('Failed to connect to database');
    }

    // Initialize services
    await initializeCache();
    
    // Initialize authentication system
    await initializeAuth();
    
    // Initialize security configuration
    if (securityConfig && securityConfig.initialize) {
      await securityConfig.initialize();
      console.log('Security configuration initialized');
    }
    
    // Initialize Redis for caching if not already done
    if (!cacheService.isConnected) {
      console.warn('Redis not connected, attempting reconnection...');
      await cacheService.connect();
    }

    // Initialize essential services first
    await realtimeService.initialize();
    await analyticsService.initialize();
    
    // Initialize background service orchestrator (handles all background services)
    try {
      console.log('🎯 Starting background service orchestrator with API priority optimization...');
      await backgroundServiceOrchestrator.initialize();
      console.log('✅ Background service orchestrator started successfully');
    } catch (error) {
      console.error('❌ Failed to start background service orchestrator:', error);
      console.warn('⚠️ Falling back to individual service initialization...');
      
      // Fallback: Initialize materialized view refresh service individually
      try {
        await materializedViewRefreshService.createMaterializedViews();
        await materializedViewRefreshService.initialize();
        console.log('Materialized view refresh service started (fallback mode)');
      } catch (fallbackError) {
        console.error('Failed to start materialized view refresh service (fallback):', fallbackError);
        // Continue without materialized views
      }
    }
    
    // Start integration monitoring with memory-optimized settings
    console.log('Starting integration monitoring...');
    await integrationMonitoringService.startMonitoring({ 
      healthCheckInterval: 600000, // 10 minutes for memory efficiency
      includeDetailedMetrics: false
    });
    
    // Create HTTP server
    const server = createServer(app);
    
    // Setup WebSocket server - TEMPORARILY DISABLED
    /*
    const wss = new WebSocketServer({ 
      server,
      path: '/api/realtime/inventory'
    });

    wss.on('connection', (ws, req) => {
      // Extract user info from query params or headers
      const url = new URL(req.url, `http://${req.headers.host}`);
      const token = url.searchParams.get('token');
      
      if (!token) {
        ws.close(1008, 'Authentication required');
        return;
      }

      // Verify JWT token
      jwt.verify(token, getKey, { algorithms: ['RS256'] }, (err, user) => {
        if (err) {
          ws.close(1008, 'Invalid token');
          return;
        }

        // Generate connection ID
        const connectionId = `${user.sub}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        // Default subscriptions
        const defaultSubscriptions = ['inventory_change', 'inventory_movement', 'stock_alert'];
        
        // Add connection to realtime service
        realtimeService.addConnection(connectionId, ws, defaultSubscriptions);
        
        console.log(`WebSocket connection established: ${connectionId}`);
        
        // Send welcome message
        ws.send(JSON.stringify({
          type: 'connection_established',
          connectionId,
          subscriptions: defaultSubscriptions,
          timestamp: new Date().toISOString()
        }));
      });
    });
    */

    // Start server on configured port
    const serverInstance = server.listen(port, () => {
      console.log(`NXT Backend running on port ${port}`);
      console.log(`WebSocket server available at ws://localhost:${port}/api/realtime/inventory`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });

    // Enhanced graceful shutdown with orchestrator and cache cleanup
    process.on('SIGTERM', async () => {
      console.log('SIGTERM received, shutting down gracefully');
      
      try {
        // Stop background service orchestrator first
        await backgroundServiceOrchestrator.shutdown();
        
        // Then stop other services
        integrationMonitoringService.stopMonitoring();
        await realtimeService.cleanup();
        await cacheService.disconnect();
        
        // Close database pool
        await closePool();
        
        server.close(() => {
          console.log('Server closed');
          process.exit(0);
        });
      } catch (error) {
        console.error('Error during graceful shutdown:', error);
        process.exit(1);
      }
    });

    process.on('SIGINT', async () => {
      console.log('SIGINT received, shutting down gracefully');
      
      try {
        // Stop background service orchestrator first
        await backgroundServiceOrchestrator.shutdown();
        
        // Then stop other services
        integrationMonitoringService.stopMonitoring();
        await realtimeService.cleanup();
        await cacheService.disconnect();
        
        // Close database pool
        await closePool();
        
        server.close(() => {
          console.log('Server closed');
          process.exit(0);
        });
      } catch (error) {
        console.error('Error during graceful shutdown:', error);
        process.exit(1);
      }
    });

    // Memory monitoring and periodic cleanup
    const memoryCheckInterval = setInterval(() => {
      const memUsage = process.memoryUsage();
      const memUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
      
      console.log(`Memory usage: ${Math.round(memUsagePercent)}% (${Math.round(memUsage.heapUsed / 1024 / 1024)}MB / ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB)`);
      
      // Force garbage collection if memory usage is high and GC is available
      if (memUsagePercent > 85 && global.gc) {
        console.log('High memory usage detected, running garbage collection');
        global.gc();
      }
    }, 120000); // Check every 2 minutes

    // Store interval reference for cleanup
    global.memoryCheckInterval = memoryCheckInterval;

  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();
