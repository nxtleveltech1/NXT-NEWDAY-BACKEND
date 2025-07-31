import express from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { body, param, query, validationResult } from 'express-validator';
import * as supplierQueries from '../db/supplier-queries.js';
import * as priceListQueries from '../db/price-list-queries.js';
import { parsePriceListFile, standardizePriceListData, validatePriceListData } from '../utils/file-parsers/index.js';
import { getUploadQueue } from '../utils/upload-queue.js';
<<<<<<< HEAD
=======
import * as supplierInventoryIntegration from '../services/supplier-inventory-integration.service.js';
import * as priceCalculationEngine from '../services/price-calculation-engine.service.js';
import * as stockAllocation from '../services/stock-allocation.service.js';
import * as inventorySync from '../services/inventory-sync.service.js';
>>>>>>> 300aab3bb16173c33b69ac31996e9bb691d90580

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
<<<<<<< HEAD
=======
 * POST /api/suppliers/:id/price-lists/:listId/approve
 * Approve price list for activation
 */
router.post('/:id/price-lists/:listId/approve', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
  param('listId').isUUID().withMessage('Invalid price list ID'),
  body('notes').optional().isLength({ max: 1000 }).withMessage('Notes must be less than 1000 characters'),
  handleValidationErrors
], async (req, res) => {
  try {
    // Verify supplier exists and price list belongs to supplier
    const supplier = await supplierQueries.getSupplierById(req.params.id);
    if (!supplier) {
      return res.status(404).json({
        success: false,
        error: 'Supplier not found'
      });
    }

    // Get price list to verify it belongs to this supplier
    const priceList = await priceListQueries.getPriceListById(req.params.listId);
    if (!priceList) {
      return res.status(404).json({
        success: false,
        error: 'Price list not found'
      });
    }

    if (priceList.supplierId !== req.params.id) {
      return res.status(403).json({
        success: false,
        error: 'Price list does not belong to this supplier'
      });
    }

    // Check current status
    if (priceList.status === 'approved') {
      return res.status(400).json({
        success: false,
        error: 'Price list is already approved'
      });
    }

    if (priceList.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: `Cannot approve price list with status: ${priceList.status}`
      });
    }

    // Approve the price list
    const approvedPriceList = await priceListQueries.updatePriceListStatus(
      req.params.listId,
      'approved',
      req.user?.sub,
      req.body.notes
    );

    res.json({
      success: true,
      data: approvedPriceList,
      message: 'Price list approved successfully',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error approving price list:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to approve price list',
      details: err.message 
    });
  }
});

/**
>>>>>>> 300aab3bb16173c33b69ac31996e9bb691d90580
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
<<<<<<< HEAD
    const priceList = await priceListQueries.activatePriceList(req.params.listId);
    
    res.json({
      success: true,
      data: priceList,
=======
    // Verify supplier exists and price list belongs to supplier
    const supplier = await supplierQueries.getSupplierById(req.params.id);
    if (!supplier) {
      return res.status(404).json({
        success: false,
        error: 'Supplier not found'
      });
    }

    // Get price list to verify it belongs to this supplier
    const priceList = await priceListQueries.getPriceListById(req.params.listId);
    if (!priceList) {
      return res.status(404).json({
        success: false,
        error: 'Price list not found'
      });
    }

    if (priceList.supplierId !== req.params.id) {
      return res.status(403).json({
        success: false,
        error: 'Price list does not belong to this supplier'
      });
    }

    // Check if price list is approved
    if (priceList.status !== 'approved') {
      return res.status(400).json({
        success: false,
        error: 'Price list must be approved before activation',
        currentStatus: priceList.status
      });
    }

    // Activate the price list
    const activatedPriceList = await priceListQueries.activatePriceList(req.params.listId);
    
    res.json({
      success: true,
      data: activatedPriceList,
>>>>>>> 300aab3bb16173c33b69ac31996e9bb691d90580
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
<<<<<<< HEAD
=======
 * POST /api/suppliers/:id/price-lists/:listId/deactivate
 * Deactivate price list
 */
router.post('/:id/price-lists/:listId/deactivate', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
  param('listId').isUUID().withMessage('Invalid price list ID'),
  body('reason').optional().isLength({ max: 500 }).withMessage('Reason must be less than 500 characters'),
  handleValidationErrors
], async (req, res) => {
  try {
    // Verify supplier exists and price list belongs to supplier
    const supplier = await supplierQueries.getSupplierById(req.params.id);
    if (!supplier) {
      return res.status(404).json({
        success: false,
        error: 'Supplier not found'
      });
    }

    // Get price list to verify it belongs to this supplier
    const priceList = await priceListQueries.getPriceListById(req.params.listId);
    if (!priceList) {
      return res.status(404).json({
        success: false,
        error: 'Price list not found'
      });
    }

    if (priceList.supplierId !== req.params.id) {
      return res.status(403).json({
        success: false,
        error: 'Price list does not belong to this supplier'
      });
    }

    // Check if price list is active
    if (priceList.status !== 'active') {
      return res.status(400).json({
        success: false,
        error: 'Only active price lists can be deactivated',
        currentStatus: priceList.status
      });
    }

    // Deactivate the price list
    const deactivatedPriceList = await priceListQueries.updatePriceListStatus(
      req.params.listId,
      'inactive',
      req.user?.sub,
      req.body.reason
    );
    
    res.json({
      success: true,
      data: deactivatedPriceList,
      message: 'Price list deactivated successfully',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error deactivating price list:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to deactivate price list',
      details: err.message 
    });
  }
});

/**
 * GET /api/suppliers/:id/price-lists
 * Get all price lists for a supplier
 */
router.get('/:id/price-lists', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
  query('status').optional().isIn(['pending', 'approved', 'active', 'inactive']).withMessage('Invalid status'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be 1-100'),
  handleValidationErrors
], async (req, res) => {
  try {
    // Verify supplier exists
    const supplier = await supplierQueries.getSupplierById(req.params.id);
    if (!supplier) {
      return res.status(404).json({
        success: false,
        error: 'Supplier not found'
      });
    }

    const params = {
      supplierId: req.params.id,
      status: req.query.status || null,
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 10,
      sortBy: 'createdAt',
      sortOrder: 'desc'
    };

    const result = await priceListQueries.getPriceLists(params);
    
    res.json({
      success: true,
      data: result.priceLists,
      pagination: result.pagination,
      supplier: {
        id: supplier.id,
        companyName: supplier.companyName,
        supplierCode: supplier.supplierCode
      },
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error fetching supplier price lists:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch supplier price lists',
      details: err.message 
    });
  }
});

/**
>>>>>>> 300aab3bb16173c33b69ac31996e9bb691d90580
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
<<<<<<< HEAD
=======
 * POST /api/suppliers/:id/prices/bulk
 * Get bulk prices for multiple SKUs
 */
router.post('/:id/prices/bulk', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
  body('skus').isArray({ min: 1, max: 100 }).withMessage('SKUs must be an array with 1-100 items'),
  body('skus.*').isLength({ min: 1, max: 100 }).withMessage('Each SKU must be 1-100 characters'),
  body('quantity').optional().isInt({ min: 1 }).withMessage('Quantity must be positive'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { skus, quantity = 1 } = req.body;
    
    // Verify supplier exists
    const supplier = await supplierQueries.getSupplierById(req.params.id);
    if (!supplier) {
      return res.status(404).json({
        success: false,
        error: 'Supplier not found'
      });
    }

    // Get bulk prices
    const prices = await priceListQueries.getBulkSupplierPrices(
      req.params.id,
      skus,
      parseInt(quantity)
    );

    // Format response
    const response = {
      supplierId: req.params.id,
      supplierName: supplier.companyName,
      quantity: parseInt(quantity),
      prices: {},
      notFound: []
    };

    // Organize prices by SKU
    skus.forEach(sku => {
      const priceData = prices.find(p => p.sku === sku);
      if (priceData) {
        response.prices[sku] = {
          unitPrice: priceData.unitPrice,
          currency: priceData.currency,
          totalPrice: priceData.unitPrice * quantity,
          minimumOrderQuantity: priceData.minimumOrderQuantity,
          priceListId: priceData.priceListId,
          tierPricing: priceData.tierPricing || null
        };
      } else {
        response.notFound.push(sku);
      }
    });

    res.json({
      success: true,
      data: response,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error fetching bulk prices:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch bulk prices',
      details: err.message 
    });
  }
});

/**
>>>>>>> 300aab3bb16173c33b69ac31996e9bb691d90580
 * GET /api/suppliers/:id/inventory
 * Get supplier inventory levels and product information
 */
router.get('/:id/inventory', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
<<<<<<< HEAD
=======
  query('warehouseId').optional().isUUID().withMessage('Invalid warehouse ID'),
  query('lowStock').optional().isBoolean().withMessage('lowStock must be boolean'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be 1-100'),
>>>>>>> 300aab3bb16173c33b69ac31996e9bb691d90580
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
<<<<<<< HEAD
=======
 * GET /api/suppliers/:id/price-lists/template/:format
 * Download price list template for supplier
 */
router.get('/:id/price-lists/template/:format', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
  param('format').isIn(['CSV', 'EXCEL', 'JSON']).withMessage('Format must be CSV, EXCEL, or JSON'),
  handleValidationErrors
], async (req, res) => {
  try {
    const format = req.params.format.toUpperCase();
    
    // Verify supplier exists
    const supplier = await supplierQueries.getSupplierById(req.params.id);
    if (!supplier) {
      return res.status(404).json({
        success: false,
        error: 'Supplier not found'
      });
    }
    
    // Import file parser dynamically
    const { generatePriceListTemplate, SUPPORTED_FILE_TYPES } = 
      await import('../utils/file-parsers/index.js');
    
    if (!SUPPORTED_FILE_TYPES[format] || !SUPPORTED_FILE_TYPES[format].templateGenerator) {
      return res.status(400).json({ 
        success: false,
        error: `Template not available for ${format} format` 
      });
    }

    const template = generatePriceListTemplate(format);
    
    // Set appropriate headers
    const config = SUPPORTED_FILE_TYPES[format];
    const extension = config.extensions[0];
    const mimeType = config.mimeTypes[0];
    
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${supplier.supplierCode || 'supplier'}-price-list-template${extension}"`);
    
    // Send the template
    if (format === 'CSV') {
      res.send(template);
    } else {
      res.send(Buffer.from(template));
    }
  } catch (err) {
    console.error('Error generating template:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to generate template',
      details: err.message 
    });
  }
});

/**
>>>>>>> 300aab3bb16173c33b69ac31996e9bb691d90580
 * POST /api/suppliers/:id/purchase-receipt
 * Record purchase receipt from supplier
 */
router.post('/:id/purchase-receipt', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
<<<<<<< HEAD
  body('referenceNumber').isLength({ min: 1, max: 100 }).withMessage('Reference number required'),
  body('items').isArray({ min: 1 }).withMessage('Items array required'),
  body('items.*.productId').isUUID().withMessage('Valid product ID required'),
  body('items.*.warehouseId').isUUID().withMessage('Valid warehouse ID required'),
  body('items.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be positive'),
  body('items.*.unitCost').isFloat({ min: 0 }).withMessage('Unit cost must be non-negative'),
=======
  body('referenceNumber').isLength({ min: 1, max: 100 }).withMessage('Reference number must be 1-100 characters'),
  body('purchaseOrderNumber').optional().isLength({ min: 1, max: 100 }).withMessage('Purchase order number must be 1-100 characters'),
  body('items').isArray({ min: 1 }).withMessage('Items array required with at least one item'),
  body('items.*.productId').isUUID().withMessage('Valid product ID required for each item'),
  body('items.*.warehouseId').isUUID().withMessage('Valid warehouse ID required for each item'),
  body('items.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be positive integer'),
  body('items.*.unitCost').isFloat({ min: 0 }).withMessage('Unit cost must be non-negative number'),
  body('items.*.sku').optional().isLength({ min: 1, max: 100 }).withMessage('SKU must be 1-100 characters'),
  body('notes').optional().isLength({ max: 1000 }).withMessage('Notes must be less than 1000 characters'),
  body('deliveryDate').optional().isISO8601().withMessage('Delivery date must be valid ISO8601 date'),
>>>>>>> 300aab3bb16173c33b69ac31996e9bb691d90580
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

<<<<<<< HEAD
=======
/**
 * GET /api/suppliers/:id/performance
 * Get detailed supplier performance metrics
 */
router.get('/:id/performance', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
  query('dateFrom').optional().isISO8601().withMessage('Invalid date format'),
  query('dateTo').optional().isISO8601().withMessage('Invalid date format'),
  query('metrics').optional().isIn(['all', 'delivery', 'quality', 'cost', 'compliance']).withMessage('Invalid metrics type'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { dateFrom, dateTo, metrics = 'all' } = req.query;
    
    // Verify supplier exists
    const supplier = await supplierQueries.getSupplierById(req.params.id);
    if (!supplier) {
      return res.status(404).json({
        success: false,
        error: 'Supplier not found'
      });
    }

    // Get performance data
    const [leadTimes, reorderData, priceHistory] = await Promise.all([
      supplierQueries.getSupplierLeadTimes(req.params.id, { dateFrom, dateTo }),
      supplierQueries.getSupplierReorderSuggestions(req.params.id),
      priceListQueries.getSupplierPriceHistory(req.params.id, { dateFrom, dateTo })
    ]);

    // Calculate performance metrics
    const performance = {
      supplierId: req.params.id,
      supplierName: supplier.companyName,
      period: { from: dateFrom, to: dateTo },
      metrics: {}
    };

    // Delivery performance
    if (metrics === 'all' || metrics === 'delivery') {
      performance.metrics.delivery = {
        averageLeadTime: leadTimes.length > 0 ? 
          leadTimes.reduce((sum, lt) => sum + parseFloat(lt.averageLeadTime || 0), 0) / leadTimes.length : null,
        onTimeDeliveryRate: 95.5, // Placeholder - would calculate from actual delivery data
        leadTimeConsistency: leadTimes.length > 0 ? 
          Math.sqrt(leadTimes.reduce((sum, lt) => sum + Math.pow(lt.averageLeadTime - performance.metrics.delivery.averageLeadTime, 2), 0) / leadTimes.length) : null,
        totalDeliveries: leadTimes.reduce((sum, lt) => sum + (lt.totalDeliveries || 0), 0)
      };
    }

    // Quality metrics
    if (metrics === 'all' || metrics === 'quality') {
      performance.metrics.quality = {
        defectRate: 0.02, // 2% - placeholder
        returnRate: 0.01, // 1% - placeholder
        qualityScore: 98, // Out of 100
        totalInspections: 150, // Placeholder
        passedInspections: 147 // Placeholder
      };
    }

    // Cost metrics
    if (metrics === 'all' || metrics === 'cost') {
      performance.metrics.cost = {
        priceStability: priceHistory.length > 1 ? 
          (priceHistory.filter(p => p.priceChange === 0).length / priceHistory.length * 100) : 100,
        averagePriceChange: priceHistory.length > 0 ?
          priceHistory.reduce((sum, p) => sum + (p.priceChangePercent || 0), 0) / priceHistory.length : 0,
        costSavingsOpportunities: reorderData.filter(r => r.potentialSavings > 0).length,
        totalPotentialSavings: reorderData.reduce((sum, r) => sum + (r.potentialSavings || 0), 0)
      };
    }

    // Compliance metrics
    if (metrics === 'all' || metrics === 'compliance') {
      performance.metrics.compliance = {
        documentationCompliance: 100, // Placeholder
        certificationStatus: 'current', // Placeholder
        auditScore: 95, // Placeholder
        lastAuditDate: '2025-06-15', // Placeholder
        nextAuditDate: '2025-12-15' // Placeholder
      };
    }

    // Overall performance score
    performance.overallScore = calculateOverallPerformanceScore(performance.metrics);
    performance.rating = performance.overallScore >= 90 ? 'excellent' :
                        performance.overallScore >= 80 ? 'good' :
                        performance.overallScore >= 70 ? 'fair' : 'needs improvement';

    res.json({
      success: true,
      data: performance,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error fetching supplier performance:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch supplier performance',
      details: err.message 
    });
  }
});

// Helper function to calculate overall performance score
function calculateOverallPerformanceScore(metrics) {
  let totalScore = 0;
  let weights = 0;

  if (metrics.delivery) {
    const deliveryScore = metrics.delivery.onTimeDeliveryRate || 0;
    totalScore += deliveryScore * 0.3;
    weights += 0.3;
  }

  if (metrics.quality) {
    const qualityScore = metrics.quality.qualityScore || 0;
    totalScore += qualityScore * 0.3;
    weights += 0.3;
  }

  if (metrics.cost) {
    const costScore = Math.min(100, 100 - Math.abs(metrics.cost.averagePriceChange || 0));
    totalScore += costScore * 0.2;
    weights += 0.2;
  }

  if (metrics.compliance) {
    const complianceScore = metrics.compliance.auditScore || 0;
    totalScore += complianceScore * 0.2;
    weights += 0.2;
  }

  return weights > 0 ? Math.round(totalScore / weights) : 0;
}

>>>>>>> 300aab3bb16173c33b69ac31996e9bb691d90580
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
<<<<<<< HEAD
=======
  query('includeComparison').optional().isBoolean().withMessage('includeComparison must be boolean'),
>>>>>>> 300aab3bb16173c33b69ac31996e9bb691d90580
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

<<<<<<< HEAD
=======
// ==================== INVENTORY INTEGRATION ENDPOINTS ====================

/**
 * POST /api/suppliers/:id/price-lists/:listId/sync-inventory
 * Sync inventory costs when price list is activated
 */
router.post('/:id/price-lists/:listId/sync-inventory', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
  param('listId').isUUID().withMessage('Invalid price list ID'),
  handleValidationErrors
], async (req, res) => {
  try {
    // Verify price list belongs to supplier and is active
    const priceList = await priceListQueries.getPriceListById(req.params.listId);
    if (!priceList || priceList.supplierId !== req.params.id) {
      return res.status(404).json({
        success: false,
        error: 'Price list not found or does not belong to supplier'
      });
    }

    if (priceList.status !== 'active') {
      return res.status(400).json({
        success: false,
        error: 'Price list must be active to sync inventory costs'
      });
    }

    // Sync inventory costs
    const result = await supplierInventoryIntegration.updateInventoryCostsFromPriceList(req.params.listId);

    res.json({
      success: true,
      data: result,
      message: `Updated costs for ${result.updatedRecords} inventory records`,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error syncing inventory costs:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to sync inventory costs',
      details: err.message 
    });
  }
});

/**
 * GET /api/suppliers/:id/stock-levels
 * Get supplier-specific stock levels across warehouses
 */
router.get('/:id/stock-levels', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
  handleValidationErrors
], async (req, res) => {
  try {
    const stockLevels = await supplierInventoryIntegration.getSupplierStockLevels(req.params.id);

    res.json({
      success: true,
      data: stockLevels,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error fetching supplier stock levels:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch supplier stock levels',
      details: err.message 
    });
  }
});

/**
 * GET /api/suppliers/:id/performance-metrics
 * Get supplier performance metrics for inventory management
 */
router.get('/:id/performance-metrics', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
  query('dateFrom').optional().isISO8601().withMessage('Invalid date format'),
  query('dateTo').optional().isISO8601().withMessage('Invalid date format'),
  handleValidationErrors
], async (req, res) => {
  try {
    const metrics = await supplierInventoryIntegration.getSupplierPerformanceMetrics(
      req.params.id,
      req.query.dateFrom,
      req.query.dateTo
    );

    res.json({
      success: true,
      data: metrics,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error fetching supplier performance metrics:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch supplier performance metrics',
      details: err.message 
    });
  }
});

/**
 * POST /api/suppliers/:id/calculate-price
 * Calculate pricing for products with tier pricing
 */
router.post('/:id/calculate-price', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
  body('sku').isLength({ min: 1, max: 100 }).withMessage('SKU required'),
  body('quantity').isInt({ min: 1 }).withMessage('Quantity must be positive integer'),
  body('currency').optional().isIn(['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CNY']).withMessage('Invalid currency'),
  body('includeShipping').optional().isBoolean().withMessage('includeShipping must be boolean'),
  body('includeTaxes').optional().isBoolean().withMessage('includeTaxes must be boolean'),
  body('taxRate').optional().isFloat({ min: 0, max: 100 }).withMessage('Tax rate must be 0-100'),
  body('shippingCost').optional().isFloat({ min: 0 }).withMessage('Shipping cost must be non-negative'),
  handleValidationErrors
], async (req, res) => {
  try {
    const pricing = await priceCalculationEngine.calculateProductPricing(
      req.body.sku,
      req.params.id,
      req.body.quantity,
      {
        currency: req.body.currency,
        includeShipping: req.body.includeShipping,
        includeTaxes: req.body.includeTaxes,
        taxRate: req.body.taxRate,
        shippingCost: req.body.shippingCost
      }
    );

    res.json({
      success: true,
      data: pricing,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error calculating price:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to calculate price',
      details: err.message 
    });
  }
});

/**
 * POST /api/suppliers/:id/calculate-bulk-pricing
 * Calculate prices for multiple products
 */
router.post('/:id/calculate-bulk-pricing', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
  body('items').isArray({ min: 1, max: 100 }).withMessage('Items array required with 1-100 items'),
  body('items.*.sku').isLength({ min: 1, max: 100 }).withMessage('Each item must have a SKU'),
  body('items.*.quantity').isInt({ min: 1 }).withMessage('Each item quantity must be positive'),
  body('currency').optional().isIn(['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CNY']).withMessage('Invalid currency'),
  handleValidationErrors
], async (req, res) => {
  try {
    const bulkPricing = await priceCalculationEngine.calculateBulkPricing(
      req.body.items,
      req.params.id,
      { currency: req.body.currency }
    );

    res.json({
      success: true,
      data: bulkPricing,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error calculating bulk pricing:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to calculate bulk pricing',
      details: err.message 
    });
  }
});

/**
 * GET /api/suppliers/:id/price-history/:sku
 * Get historical pricing for a product
 */
router.get('/:id/price-history/:sku', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
  param('sku').isLength({ min: 1, max: 100 }).withMessage('Invalid SKU'),
  query('dateFrom').optional().isISO8601().withMessage('Invalid date format'),
  query('dateTo').optional().isISO8601().withMessage('Invalid date format'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be 1-100'),
  handleValidationErrors
], async (req, res) => {
  try {
    const history = await priceCalculationEngine.getHistoricalPrices(
      req.params.sku,
      req.params.id,
      {
        dateFrom: req.query.dateFrom,
        dateTo: req.query.dateTo,
        limit: parseInt(req.query.limit) || 12
      }
    );

    res.json({
      success: true,
      data: history,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error fetching price history:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch price history',
      details: err.message 
    });
  }
});

/**
 * POST /api/suppliers/:id/compare-prices
 * Compare prices across suppliers for a product
 */
router.post('/compare-prices', [
  generalRateLimit,
  body('sku').isLength({ min: 1, max: 100 }).withMessage('SKU required'),
  body('quantity').isInt({ min: 1 }).withMessage('Quantity must be positive integer'),
  handleValidationErrors
], async (req, res) => {
  try {
    const comparison = await priceCalculationEngine.compareSupplierPrices(
      req.body.sku,
      req.body.quantity
    );

    res.json({
      success: true,
      data: comparison,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error comparing prices:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to compare prices',
      details: err.message 
    });
  }
});

/**
 * POST /api/suppliers/:id/optimal-quantity
 * Suggest optimal order quantity based on price breaks
 */
router.post('/:id/optimal-quantity', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
  body('sku').isLength({ min: 1, max: 100 }).withMessage('SKU required'),
  body('targetQuantity').isInt({ min: 1 }).withMessage('Target quantity must be positive'),
  handleValidationErrors
], async (req, res) => {
  try {
    const suggestion = await priceCalculationEngine.suggestOptimalQuantity(
      req.body.sku,
      req.params.id,
      req.body.targetQuantity
    );

    res.json({
      success: true,
      data: suggestion,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error suggesting optimal quantity:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to suggest optimal quantity',
      details: err.message 
    });
  }
});

/**
 * POST /api/suppliers/:id/allocate-stock
 * Allocate supplier stock to orders
 */
router.post('/:id/allocate-stock', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
  body('orderId').isUUID().withMessage('Valid order ID required'),
  body('preferThisSupplier').optional().isBoolean().withMessage('preferThisSupplier must be boolean'),
  handleValidationErrors
], async (req, res) => {
  try {
    const preferredSuppliers = req.body.preferThisSupplier ? [req.params.id] : [];
    const allocation = await stockAllocation.allocateStockToOrder(
      req.body.orderId,
      preferredSuppliers
    );

    res.json({
      success: true,
      data: allocation,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error allocating stock:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to allocate stock',
      details: err.message 
    });
  }
});

/**
 * GET /api/suppliers/:id/reorder-suggestions-enhanced
 * Get enhanced reorder suggestions with lead time considerations
 */
router.get('/:id/reorder-suggestions-enhanced', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
  query('includeForecasting').optional().isBoolean().withMessage('includeForecasting must be boolean'),
  query('leadTimeBuffer').optional().isFloat({ min: 1, max: 2 }).withMessage('Lead time buffer must be 1-2'),
  handleValidationErrors
], async (req, res) => {
  try {
    // Get all reorder suggestions
    const allSuggestions = await stockAllocation.generateReorderSuggestions({
      includeForecasting: req.query.includeForecasting === 'true',
      leadTimeBuffer: parseFloat(req.query.leadTimeBuffer) || 1.2
    });

    // Filter for this supplier
    const supplierSuggestions = allSuggestions.suggestions.filter(
      s => s.supplierId === req.params.id
    );

    const groupedData = allSuggestions.groupedBySupplier.find(
      g => g.supplierId === req.params.id
    );

    res.json({
      success: true,
      data: {
        suggestions: supplierSuggestions,
        summary: groupedData || {
          supplierId: req.params.id,
          items: [],
          totalItems: 0,
          totalQuantity: 0,
          totalEstimatedCost: 0
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error fetching enhanced reorder suggestions:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch enhanced reorder suggestions',
      details: err.message 
    });
  }
});

/**
 * GET /api/suppliers/:id/allocation-performance
 * Track supplier performance in stock allocations
 */
router.get('/:id/allocation-performance', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
  query('dateFrom').optional().isISO8601().withMessage('Invalid date format'),
  query('dateTo').optional().isISO8601().withMessage('Invalid date format'),
  handleValidationErrors
], async (req, res) => {
  try {
    const performance = await stockAllocation.trackSupplierPerformance(
      req.params.id,
      {
        startDate: req.query.dateFrom ? new Date(req.query.dateFrom) : undefined,
        endDate: req.query.dateTo ? new Date(req.query.dateTo) : undefined
      }
    );

    res.json({
      success: true,
      data: performance,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error fetching allocation performance:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch allocation performance',
      details: err.message 
    });
  }
});

/**
 * POST /api/suppliers/:id/sync-stock-levels
 * Sync supplier stock availability data
 */
router.post('/:id/sync-stock-levels', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
  body('stockData').isArray({ min: 1 }).withMessage('Stock data array required'),
  body('stockData.*.sku').isLength({ min: 1, max: 100 }).withMessage('Each item must have SKU'),
  body('stockData.*.availableQuantity').isInt({ min: 0 }).withMessage('Available quantity must be non-negative'),
  body('stockData.*.onOrderQuantity').optional().isInt({ min: 0 }).withMessage('On order quantity must be non-negative'),
  body('stockData.*.leadTimeDays').optional().isInt({ min: 0 }).withMessage('Lead time must be non-negative'),
  body('updateLeadTimes').optional().isBoolean().withMessage('updateLeadTimes must be boolean'),
  body('updateMOQ').optional().isBoolean().withMessage('updateMOQ must be boolean'),
  handleValidationErrors
], async (req, res) => {
  try {
    const syncResult = await inventorySync.syncSupplierStockLevels(
      req.params.id,
      req.body.stockData,
      {
        updateLeadTimes: req.body.updateLeadTimes,
        updateMOQ: req.body.updateMOQ
      }
    );

    res.json({
      success: true,
      data: syncResult,
      message: `Synced ${syncResult.updated} inventory records`,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error syncing stock levels:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to sync stock levels',
      details: err.message 
    });
  }
});

/**
 * POST /api/suppliers/:id/batch-cost-update
 * Batch update inventory costs
 */
router.post('/:id/batch-cost-update', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
  body('updates').isArray({ min: 1, max: 1000 }).withMessage('Updates array required (max 1000)'),
  body('updates.*.inventoryId').isInt().withMessage('Each update must have inventory ID'),
  body('updates.*.newCost').isFloat({ min: 0 }).withMessage('New cost must be non-negative'),
  body('conflictResolution').optional().isIn(['latest', 'highest', 'average']).withMessage('Invalid conflict resolution strategy'),
  handleValidationErrors
], async (req, res) => {
  try {
    const result = await inventorySync.batchSyncInventoryCosts(
      req.body.updates,
      {
        conflictResolution: req.body.conflictResolution || 'latest',
        notifyRealtime: true
      }
    );

    res.json({
      success: true,
      data: result,
      message: `Processed ${result.processed} updates: ${result.succeeded} succeeded, ${result.failed} failed`,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error in batch cost update:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to batch update costs',
      details: err.message 
    });
  }
});

/**
 * POST /api/suppliers/:id/schedule-sync
 * Schedule automated inventory sync for supplier
 */
router.post('/:id/schedule-sync', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
  body('intervalMinutes').isInt({ min: 15, max: 1440 }).withMessage('Interval must be 15-1440 minutes'),
  body('enabled').isBoolean().withMessage('enabled must be boolean'),
  handleValidationErrors
], async (req, res) => {
  try {
    if (req.body.enabled) {
      inventorySync.syncScheduler.scheduleSupplierSync(
        req.params.id,
        req.body.intervalMinutes
      );
      
      res.json({
        success: true,
        message: `Scheduled sync for supplier every ${req.body.intervalMinutes} minutes`,
        timestamp: new Date().toISOString()
      });
    } else {
      inventorySync.syncScheduler.clearSupplierSync(req.params.id);
      
      res.json({
        success: true,
        message: 'Sync schedule cleared for supplier',
        timestamp: new Date().toISOString()
      });
    }
  } catch (err) {
    console.error('Error scheduling sync:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to schedule sync',
      details: err.message 
    });
  }
});

/**
 * GET /api/suppliers/:id/sync-status
 * Get sync status and history for supplier
 */
router.get('/:id/sync-status', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
  query('limit').optional().isInt({ min: 1, max: 500 }).withMessage('Limit must be 1-500'),
  handleValidationErrors
], async (req, res) => {
  try {
    const status = await inventorySync.getSyncStatus({
      supplierId: req.params.id,
      limit: parseInt(req.query.limit) || 100
    });

    res.json({
      success: true,
      data: status,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error fetching sync status:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch sync status',
      details: err.message 
    });
  }
});

>>>>>>> 300aab3bb16173c33b69ac31996e9bb691d90580
export default router;