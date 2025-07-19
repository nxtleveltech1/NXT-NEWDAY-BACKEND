import express from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { body, param, query, validationResult } from 'express-validator';
import * as supplierQueries from '../db/supplier-queries.js';
import * as priceListQueries from '../db/price-list-queries.js';
import { parsePriceListFile, standardizePriceListData, validatePriceListData } from '../utils/file-parsers/index.js';
import { getUploadQueue } from '../utils/upload-queue.js';

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // Validate file types
    const allowedMimeTypes = [
      'text/csv',
      'application/csv',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/json',
      'application/xml',
      'text/xml',
      'application/pdf'
    ];
    
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`), false);
    }
  }
});

// Rate limiting for upload endpoints
const uploadRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 uploads per window per IP
  message: {
    error: 'Too many upload requests, please try again later',
    retryAfter: 15 * 60
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Rate limiting for general API calls
const generalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // 1000 requests per window per IP
  message: {
    error: 'Too many requests, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Validation middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array()
    });
  }
  next();
};

// Supplier validation rules
const supplierValidationRules = [
  body('companyName').isLength({ min: 2, max: 255 }).withMessage('Company name must be 2-255 characters'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('supplierCode').optional().isLength({ min: 2, max: 50 }).withMessage('Supplier code must be 2-50 characters'),
  body('contactPerson').optional().isLength({ min: 2, max: 255 }).withMessage('Contact person must be 2-255 characters'),
  body('phone').optional().isMobilePhone().withMessage('Valid phone number required'),
  body('address').optional().isLength({ max: 1000 }).withMessage('Address must be less than 1000 characters'),
  body('paymentTerms').optional().isInt({ min: 0, max: 365 }).withMessage('Payment terms must be 0-365 days'),
  body('isActive').optional().isBoolean().withMessage('isActive must be boolean')
];

const supplierUpdateValidationRules = [
  param('id').isUUID().withMessage('Invalid supplier ID'),
  body('companyName').optional().isLength({ min: 2, max: 255 }).withMessage('Company name must be 2-255 characters'),
  body('email').optional().isEmail().withMessage('Valid email is required'),
  body('supplierCode').optional().isLength({ min: 2, max: 50 }).withMessage('Supplier code must be 2-50 characters'),
  body('contactPerson').optional().isLength({ min: 2, max: 255 }).withMessage('Contact person must be 2-255 characters'),
  body('phone').optional().isMobilePhone().withMessage('Valid phone number required'),
  body('address').optional().isLength({ max: 1000 }).withMessage('Address must be less than 1000 characters'),
  body('paymentTerms').optional().isInt({ min: 0, max: 365 }).withMessage('Payment terms must be 0-365 days'),
  body('isActive').optional().isBoolean().withMessage('isActive must be boolean')
];

// ==================== SUPPLIER CRUD ENDPOINTS ====================

/**
 * GET /api/suppliers
 * Get all suppliers with filtering and pagination
 */
router.get('/', [
  generalRateLimit,
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be 1-100'),
  query('search').optional().isLength({ max: 255 }).withMessage('Search term too long'),
  query('isActive').optional().isBoolean().withMessage('isActive must be boolean'),
  query('sortBy').optional().isIn(['companyName', 'supplierCode', 'createdAt', 'updatedAt']).withMessage('Invalid sort field'),
  query('sortOrder').optional().isIn(['asc', 'desc']).withMessage('Sort order must be asc or desc'),
  handleValidationErrors
], async (req, res) => {
  try {
    const params = {
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 10,
      search: req.query.search || '',
      isActive: req.query.isActive === 'true' ? true : req.query.isActive === 'false' ? false : null,
      sortBy: req.query.sortBy || 'createdAt',
      sortOrder: req.query.sortOrder || 'desc'
    };
    
    const result = await supplierQueries.getSuppliers(params);
    
    res.json({
      success: true,
      data: result.suppliers,
      pagination: result.pagination,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error fetching suppliers:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch suppliers',
      details: err.message 
    });
  }
});

/**
 * GET /api/suppliers/search
 * Advanced supplier search with multiple criteria
 */
router.get('/search', [
  generalRateLimit,
  query('q').optional().isLength({ min: 1, max: 255 }).withMessage('Search query required'),
  query('category').optional().isLength({ max: 100 }).withMessage('Category too long'),
  query('location').optional().isLength({ max: 255 }).withMessage('Location too long'),
  query('paymentTermsMin').optional().isInt({ min: 0 }).withMessage('Payment terms min must be non-negative'),
  query('paymentTermsMax').optional().isInt({ min: 0 }).withMessage('Payment terms max must be non-negative'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { q, category, location, paymentTermsMin, paymentTermsMax } = req.query;
    
    // Build advanced search parameters
    const searchParams = {
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 20,
      search: q || '',
      isActive: true // Only search active suppliers
    };

    const result = await supplierQueries.getSuppliers(searchParams);
    
    res.json({
      success: true,
      data: result.suppliers,
      pagination: result.pagination,
      searchCriteria: { q, category, location, paymentTermsMin, paymentTermsMax },
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error searching suppliers:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to search suppliers',
      details: err.message 
    });
  }
});

/**
 * GET /api/suppliers/:id
 * Get supplier by ID
 */
router.get('/:id', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
  handleValidationErrors
], async (req, res) => {
  try {
    const supplier = await supplierQueries.getSupplierById(req.params.id);
    if (!supplier) {
      return res.status(404).json({ 
        success: false,
        error: 'Supplier not found' 
      });
    }
    
    res.json({
      success: true,
      data: supplier,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error fetching supplier:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch supplier',
      details: err.message 
    });
  }
});

/**
 * POST /api/suppliers
 * Create new supplier
 */
router.post('/', [
  generalRateLimit,
  ...supplierValidationRules,
  handleValidationErrors
], async (req, res) => {
  try {
    // Check if supplier with same email already exists
    const existingSupplier = await supplierQueries.supplierExistsByEmail(req.body.email);
    if (existingSupplier) {
      return res.status(409).json({
        success: false,
        error: 'Supplier with this email already exists'
      });
    }

    const supplier = await supplierQueries.createSupplier({
      ...req.body,
      createdBy: req.user?.sub
    });
    
    res.status(201).json({
      success: true,
      data: supplier,
      message: 'Supplier created successfully',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error creating supplier:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to create supplier',
      details: err.message 
    });
  }
});

/**
 * PUT /api/suppliers/:id
 * Update supplier
 */
router.put('/:id', [
  generalRateLimit,
  ...supplierUpdateValidationRules,
  handleValidationErrors
], async (req, res) => {
  try {
    const supplier = await supplierQueries.updateSupplier(req.params.id, {
      ...req.body,
      updatedBy: req.user?.sub
    });
    
    if (!supplier) {
      return res.status(404).json({ 
        success: false,
        error: 'Supplier not found' 
      });
    }
    
    res.json({
      success: true,
      data: supplier,
      message: 'Supplier updated successfully',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error updating supplier:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to update supplier',
      details: err.message 
    });
  }
});

/**
 * DELETE /api/suppliers/:id
 * Deactivate supplier (soft delete)
 */
router.delete('/:id', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
  handleValidationErrors
], async (req, res) => {
  try {
    const supplier = await supplierQueries.deactivateSupplier(req.params.id);
    if (!supplier) {
      return res.status(404).json({ 
        success: false,
        error: 'Supplier not found' 
      });
    }
    
    res.json({
      success: true,
      message: 'Supplier deactivated successfully',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error deactivating supplier:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to deactivate supplier',
      details: err.message 
    });
  }
});

// ==================== PRICE LIST ENDPOINTS ====================

/**
 * POST /api/suppliers/:id/price-lists
 * Upload price list for supplier (multipart)
 */
router.post('/:id/price-lists', [
  uploadRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
  handleValidationErrors,
  upload.single('file')
], async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false,
        error: 'No file uploaded' 
      });
    }

    const supplierId = req.params.id;
    
    // Verify supplier exists
    const supplier = await supplierQueries.getSupplierById(supplierId);
    if (!supplier) {
      return res.status(404).json({
        success: false,
        error: 'Supplier not found'
      });
    }

    // Add to upload queue for processing
    const uploadQueue = getUploadQueue();
    const uploadId = await uploadQueue.enqueue({
      type: 'price_list_upload',
      supplierId,
      userId: req.user?.sub,
      file: {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        buffer: req.file.buffer,
        size: req.file.size
      },
      metadata: {
        uploadedBy: req.user?.sub,
        uploadedAt: new Date().toISOString(),
        clientIP: req.ip,
        userAgent: req.get('User-Agent')
      }
    });

    res.status(202).json({
      success: true,
      uploadId,
      message: 'Price list upload queued for processing',
      estimatedProcessingTime: '2-5 minutes',
      statusEndpoint: `/api/suppliers/${supplierId}/price-lists/upload/${uploadId}/status`,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error('Error uploading price list:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to upload price list',
      details: err.message 
    });
  }
});

/**
 * GET /api/suppliers/:id/price-lists/upload/:uploadId/status
 * Get upload status
 */
router.get('/:id/price-lists/upload/:uploadId/status', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
  param('uploadId').isLength({ min: 1 }).withMessage('Upload ID required'),
  handleValidationErrors
], async (req, res) => {
  try {
    const uploadQueue = getUploadQueue();
    const status = uploadQueue.getUploadStatus(req.params.uploadId);
    
    if (!status) {
      return res.status(404).json({
        success: false,
        error: 'Upload not found'
      });
    }

    res.json({
      success: true,
      data: status,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error fetching upload status:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch upload status',
      details: err.message 
    });
  }
});

/**
 * POST /api/suppliers/:id/price-lists/:listId/activate
 * Activate price list
 */
router.post('/:id/price-lists/:listId/activate', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
  param('listId').isUUID().withMessage('Invalid price list ID'),
  handleValidationErrors
], async (req, res) => {
  try {
    const priceList = await priceListQueries.activatePriceList(req.params.listId);
    
    res.json({
      success: true,
      data: priceList,
      message: 'Price list activated successfully',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error activating price list:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to activate price list',
      details: err.message 
    });
  }
});

/**
 * GET /api/suppliers/:id/prices
 * Get current prices for supplier products
 */
router.get('/:id/prices', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
  query('sku').optional().isLength({ min: 1, max: 100 }).withMessage('Invalid SKU'),
  query('category').optional().isLength({ max: 100 }).withMessage('Category too long'),
  query('quantity').optional().isInt({ min: 1 }).withMessage('Quantity must be positive'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { sku, category, quantity = 1 } = req.query;
    
    if (sku) {
      // Get price for specific SKU
      const price = await priceListQueries.getSupplierPrice(
        req.params.id, 
        sku, 
        parseInt(quantity)
      );
      
      if (!price) {
        return res.status(404).json({
          success: false,
          error: 'Price not found for SKU'
        });
      }
      
      res.json({
        success: true,
        data: price,
        timestamp: new Date().toISOString()
      });
    } else {
      // Get supplier with price lists
      const supplierWithPrices = await supplierQueries.getSupplierWithPriceLists(req.params.id);
      
      if (!supplierWithPrices) {
        return res.status(404).json({
          success: false,
          error: 'Supplier not found'
        });
      }
      
      res.json({
        success: true,
        data: supplierWithPrices,
        timestamp: new Date().toISOString()
      });
    }
  } catch (err) {
    console.error('Error fetching supplier prices:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch supplier prices',
      details: err.message 
    });
  }
});

/**
 * GET /api/suppliers/:id/inventory
 * Get supplier inventory levels and product information
 */
router.get('/:id/inventory', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
  handleValidationErrors
], async (req, res) => {
  try {
    const result = await supplierQueries.getSupplierWithInventory(req.params.id);
    if (!result) {
      return res.status(404).json({ 
        success: false,
        error: 'Supplier not found' 
      });
    }
    
    res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error fetching supplier inventory:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch supplier inventory',
      details: err.message 
    });
  }
});

/**
 * POST /api/suppliers/:id/purchase-receipt
 * Record purchase receipt from supplier
 */
router.post('/:id/purchase-receipt', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
  body('referenceNumber').isLength({ min: 1, max: 100 }).withMessage('Reference number required'),
  body('items').isArray({ min: 1 }).withMessage('Items array required'),
  body('items.*.productId').isUUID().withMessage('Valid product ID required'),
  body('items.*.warehouseId').isUUID().withMessage('Valid warehouse ID required'),
  body('items.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be positive'),
  body('items.*.unitCost').isFloat({ min: 0 }).withMessage('Unit cost must be non-negative'),
  handleValidationErrors
], async (req, res) => {
  try {
    const receiptData = {
      ...req.body,
      supplierId: req.params.id,
      performedBy: req.user?.sub
    };
    
    const movements = await supplierQueries.updateInventoryOnPurchaseReceipt(receiptData);
    
    res.status(201).json({
      success: true,
      data: movements,
      message: 'Purchase receipt recorded successfully',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error recording purchase receipt:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to record purchase receipt',
      details: err.message 
    });
  }
});

/**
 * GET /api/suppliers/:id/lead-times
 * Get supplier lead time analysis
 */
router.get('/:id/lead-times', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
  query('productId').optional().isUUID().withMessage('Invalid product ID'),
  query('dateFrom').optional().isISO8601().withMessage('Invalid date format'),
  query('dateTo').optional().isISO8601().withMessage('Invalid date format'),
  handleValidationErrors
], async (req, res) => {
  try {
    const params = {
      productId: req.query.productId || null,
      dateFrom: req.query.dateFrom || null,
      dateTo: req.query.dateTo || null
    };
    
    const leadTimes = await supplierQueries.getSupplierLeadTimes(req.params.id, params);
    
    res.json({
      success: true,
      data: leadTimes,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error fetching supplier lead times:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch supplier lead times',
      details: err.message 
    });
  }
});

/**
 * GET /api/suppliers/:id/reorder-suggestions
 * Get reorder suggestions for supplier products
 */
router.get('/:id/reorder-suggestions', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
  handleValidationErrors
], async (req, res) => {
  try {
    const suggestions = await supplierQueries.getSupplierReorderSuggestions(req.params.id);
    
    res.json({
      success: true,
      data: suggestions,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error fetching supplier reorder suggestions:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch supplier reorder suggestions',
      details: err.message 
    });
  }
});

// ==================== SUPPLIER ANALYTICS ENDPOINTS ====================

/**
 * GET /api/suppliers/:id/analytics
 * Get supplier analytics and performance metrics
 */
router.get('/:id/analytics', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
  query('dateFrom').optional().isISO8601().withMessage('Invalid date format'),
  query('dateTo').optional().isISO8601().withMessage('Invalid date format'),
  query('includeDetails').optional().isBoolean().withMessage('includeDetails must be boolean'),
  handleValidationErrors
], async (req, res) => {
  try {
    const supplierId = req.params.id;
    const { dateFrom, dateTo, includeDetails = false } = req.query;
    
    // Verify supplier exists
    const supplier = await supplierQueries.getSupplierById(supplierId);
    if (!supplier) {
      return res.status(404).json({
        success: false,
        error: 'Supplier not found'
      });
    }

    // Get analytics data in parallel
    const [
      supplierWithInventory,
      leadTimes,
      reorderSuggestions,
      priceListStats
    ] = await Promise.all([
      supplierQueries.getSupplierWithInventory(supplierId),
      supplierQueries.getSupplierLeadTimes(supplierId, { dateFrom, dateTo }),
      supplierQueries.getSupplierReorderSuggestions(supplierId),
      priceListQueries.getPriceListStatistics(supplierId)
    ]);

    // Calculate summary metrics
    const analytics = {
      supplierId,
      supplierInfo: {
        companyName: supplier.companyName,
        supplierCode: supplier.supplierCode,
        isActive: supplier.isActive
      },
      performanceMetrics: {
        totalProducts: supplierWithInventory?.products?.length || 0,
        totalInventoryValue: supplierWithInventory?.products?.reduce((sum, p) => 
          sum + (parseFloat(p.totalOnHand || 0) * parseFloat(p.averageCost || 0)), 0) || 0,
        averageLeadTime: leadTimes.length > 0 ? 
          leadTimes.reduce((sum, lt) => sum + parseFloat(lt.averageLeadTime || 0), 0) / leadTimes.length : 0,
        reorderItemsCount: reorderSuggestions.length,
        priceListsTotal: priceListStats.totalPriceLists,
        activePriceLists: priceListStats.activePriceLists
      },
      inventorySummary: {
        productsInStock: supplierWithInventory?.products?.filter(p => parseFloat(p.totalOnHand || 0) > 0).length || 0,
        productsOutOfStock: supplierWithInventory?.products?.filter(p => parseFloat(p.totalOnHand || 0) === 0).length || 0,
        totalOnHand: supplierWithInventory?.products?.reduce((sum, p) => sum + parseFloat(p.totalOnHand || 0), 0) || 0,
        totalReserved: supplierWithInventory?.products?.reduce((sum, p) => sum + parseFloat(p.totalReserved || 0), 0) || 0
      },
      reorderAlerts: reorderSuggestions.slice(0, 5).map(suggestion => ({
        productId: suggestion.productId,
        productSku: suggestion.productSku,
        productName: suggestion.productName,
        availableQuantity: suggestion.totalAvailable,
        reorderPoint: suggestion.totalReorderPoint,
        suggestedQuantity: suggestion.totalReorderQuantity
      }))
    };

    // Include detailed data if requested
    if (includeDetails === 'true') {
      analytics.detailedData = {
        products: supplierWithInventory?.products || [],
        leadTimeAnalysis: leadTimes,
        fullReorderSuggestions: reorderSuggestions,
        priceListStatistics: priceListStats
      };
    }

    res.json({
      success: true,
      data: analytics,
      metadata: {
        dateFrom,
        dateTo,
        includeDetails,
        generatedAt: new Date().toISOString()
      }
    });

  } catch (err) {
    console.error('Error fetching supplier analytics:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch supplier analytics',
      details: err.message 
    });
  }
});

/**
 * GET /api/suppliers/analytics/overview
 * Get supplier analytics overview for all suppliers
 */
router.get('/analytics/overview', [
  generalRateLimit,
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be 1-100'),
  query('sortBy').optional().isIn(['performance', 'inventory_value', 'lead_time']).withMessage('Invalid sort field'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { limit = 10, sortBy = 'performance' } = req.query;
    
    // Get supplier statistics
    const supplierStats = await supplierQueries.getSupplierStatistics();
    const priceListStats = await priceListQueries.getPriceListStatistics();
    
    const overview = {
      summary: {
        totalSuppliers: supplierStats.totalSuppliers,
        activeSuppliers: supplierStats.activeSuppliers,
        inactiveSuppliers: supplierStats.totalSuppliers - supplierStats.activeSuppliers,
        totalPriceLists: priceListStats.totalPriceLists,
        activePriceLists: priceListStats.activePriceLists,
        pendingPriceLists: priceListStats.pendingPriceLists
      },
      metrics: {
        supplierActivationRate: supplierStats.totalSuppliers > 0 ? 
          ((supplierStats.activeSuppliers / supplierStats.totalSuppliers) * 100).toFixed(1) : 0,
        priceListApprovalRate: priceListStats.totalPriceLists > 0 ? 
          ((priceListStats.approvedPriceLists / priceListStats.totalPriceLists) * 100).toFixed(1) : 0,
        averagePriceListsPerSupplier: supplierStats.activeSuppliers > 0 ? 
          (priceListStats.totalPriceLists / supplierStats.activeSuppliers).toFixed(1) : 0
      },
      timestamp: new Date().toISOString()
    };

    res.json({
      success: true,
      data: overview
    });

  } catch (err) {
    console.error('Error fetching supplier analytics overview:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch supplier analytics overview',
      details: err.message 
    });
  }
});

export default router;