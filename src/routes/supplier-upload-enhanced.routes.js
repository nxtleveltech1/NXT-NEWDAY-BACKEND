import express from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { body, param, query, validationResult } from 'express-validator';
import { supplierUploadEnhanced } from '../services/supplier-upload-enhanced.service.js';
import { priceRulesEngine } from '../services/price-rules-engine.service.js';
import { supplierNotificationService } from '../services/supplier-notification.service.js';

const router = express.Router();

// Enhanced multer configuration for multiple file types
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit for PDF/Word files
    files: 10 // Allow multiple files for bulk upload
  },
  fileFilter: (req, file, cb) => {
    // Enhanced file type validation
    const allowedMimeTypes = [
      // Standard formats
      'text/csv',
      'application/csv',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // Excel
      'application/vnd.ms-excel',
      'application/json',
      'application/xml',
      'text/xml',
      
      // Enhanced formats
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // Word
      'application/msword',
      'message/rfc822', // Email
      'application/vnd.ms-outlook', // Outlook MSG
      'text/plain'
    ];
    
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Supported formats: CSV, Excel, JSON, XML, PDF, Word, Email`), false);
    }
  }
});

// Enhanced rate limiting
const uploadRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 uploads per window per IP (increased for enhanced service)
  message: {
    error: 'Too many upload requests, please try again later',
    retryAfter: 15 * 60
  },
  standardHeaders: true,
  legacyHeaders: false
});

const generalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000, // Increased for enhanced endpoints
  standardHeaders: true,
  legacyHeaders: false
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

// ====================
// ENHANCED UPLOAD ENDPOINTS
// ====================

/**
 * POST /api/suppliers/:id/upload-enhanced
 * Enhanced price list upload with comprehensive features
 */
router.post('/:id/upload-enhanced', [
  uploadRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
  upload.single('file'),
  body('options').optional().isJSON().withMessage('Options must be valid JSON'),
  body('priceRulesConfig').optional().isJSON().withMessage('Price rules config must be valid JSON'),
  body('requirePreview').optional().isBoolean().withMessage('requirePreview must be boolean'),
  body('requireApproval').optional().isBoolean().withMessage('requireApproval must be boolean'),
  body('autoActivate').optional().isBoolean().withMessage('autoActivate must be boolean'),
  body('notifySupplier').optional().isBoolean().withMessage('notifySupplier must be boolean'),
  body('duplicateHandling').optional().isIn(['skip', 'overwrite', 'warn', 'merge']).withMessage('Invalid duplicate handling option'),
  handleValidationErrors
], async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    const supplierId = req.params.id;
    const userId = req.user?.sub || 'system';

    // Parse options from request body
    const options = req.body.options ? JSON.parse(req.body.options) : {};
    const priceRulesConfig = req.body.priceRulesConfig ? JSON.parse(req.body.priceRulesConfig) : {};

    // Enhanced upload options
    const uploadOptions = {
      ...options,
      requirePreview: req.body.requirePreview !== 'false',
      requireApproval: req.body.requireApproval !== 'false',  
      autoActivate: req.body.autoActivate === 'true',
      notifySupplier: req.body.notifySupplier !== 'false',
      duplicateHandling: req.body.duplicateHandling || 'warn',
      priceRulesConfig,
      originalFileName: req.file.originalname,
      uploadSource: 'enhanced_api'
    };

    const uploadData = {
      file: {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        buffer: req.file.buffer,
        size: req.file.size
      },
      supplierId,
      userId,
      options: uploadOptions
    };

    const result = await supplierUploadEnhanced.uploadPriceList(uploadData);

    if (result.requiresApproval) {
      return res.status(202).json({
        success: true,
        uploadId: result.uploadId,
        message: 'Upload processed, requires approval',
        preview: result.preview,
        summary: result.summary,
        approvalEndpoint: `/api/suppliers/${supplierId}/upload-enhanced/${result.uploadId}/approve`,
        previewEndpoint: `/api/suppliers/${supplierId}/upload-enhanced/${result.uploadId}/preview`
      });
    }

    if (result.requiresReview) {
      return res.status(202).json({
        success: true,
        uploadId: result.uploadId,
        message: 'Upload requires manual review',
        mappingOptions: result.mappingOptions,
        duplicates: result.duplicates,
        resolutionOptions: result.resolutionOptions,
        reviewEndpoint: `/api/suppliers/${supplierId}/upload-enhanced/${result.uploadId}/review`
      });
    }

    res.status(result.success ? 201 : 400).json({
      success: result.success,
      uploadId: result.uploadId,
      priceListId: result.priceListId,
      itemsProcessed: result.itemsProcessed,
      processingTime: result.processingTime,
      summary: result.summary,
      message: result.success ? 'Price list uploaded successfully' : 'Upload failed',
      errors: result.errors,
      statusEndpoint: `/api/suppliers/${supplierId}/upload-enhanced/${result.uploadId}/status`
    });

  } catch (error) {
    console.error('Enhanced upload error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error during upload',
      details: error.message
    });
  }
});

/**
 * POST /api/suppliers/:id/upload-enhanced/:uploadId/approve
 * Approve and execute a pending upload
 */
router.post('/:id/upload-enhanced/:uploadId/approve', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
  param('uploadId').isLength({ min: 1 }).withMessage('Upload ID required'),
  body('mappingOverrides').optional().isObject().withMessage('Mapping overrides must be object'),
  body('duplicateResolutions').optional().isObject().withMessage('Duplicate resolutions must be object'),
  body('priceRuleOverrides').optional().isObject().withMessage('Price rule overrides must be object'),
  body('comments').optional().isLength({ max: 1000 }).withMessage('Comments must be less than 1000 characters'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { uploadId } = req.params;
    const userId = req.user?.sub || 'system';

    const approvalData = {
      mappingOverrides: req.body.mappingOverrides || {},
      duplicateResolutions: req.body.duplicateResolutions || {},
      priceRuleOverrides: req.body.priceRuleOverrides || {},
      comments: req.body.comments
    };

    const result = await supplierUploadEnhanced.approveUpload(uploadId, approvalData, userId);

    res.json({
      success: result.success,
      priceListId: result.priceListId,
      itemsProcessed: result.itemsProcessed,
      summary: result.summary,
      message: 'Upload approved and completed successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Approval error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to approve upload',
      details: error.message
    });
  }
});

/**
 * GET /api/suppliers/:id/upload-enhanced/:uploadId/preview
 * Get upload preview for review
 */
router.get('/:id/upload-enhanced/:uploadId/preview', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
  param('uploadId').isLength({ min: 1 }).withMessage('Upload ID required'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { uploadId } = req.params;
    const result = await supplierUploadEnhanced.getUploadPreview(uploadId);

    if (!result.success) {
      return res.status(404).json({
        success: false,
        error: result.error
      });
    }

    res.json({
      success: true,
      preview: result.preview,
      uploadInfo: result.uploadInfo,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Preview error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get upload preview',
      details: error.message
    });
  }
});

/**
 * GET /api/suppliers/:id/upload-enhanced/:uploadId/status
 * Get enhanced upload status
 */
router.get('/:id/upload-enhanced/:uploadId/status', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
  param('uploadId').isLength({ min: 1 }).withMessage('Upload ID required'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { uploadId } = req.params;
    const status = await supplierUploadEnhanced.getUploadStatus(uploadId);

    res.json({
      success: true,
      status,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get upload status',
      details: error.message
    });
  }
});

/**
 * DELETE /api/suppliers/:id/upload-enhanced/:uploadId
 * Cancel an upload
 */
router.delete('/:id/upload-enhanced/:uploadId', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
  param('uploadId').isLength({ min: 1 }).withMessage('Upload ID required'),
  body('reason').optional().isLength({ max: 500 }).withMessage('Reason must be less than 500 characters'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { uploadId } = req.params;
    const userId = req.user?.sub || 'system';
    const reason = req.body.reason || 'Cancelled by user';

    const result = await supplierUploadEnhanced.cancelUpload(uploadId, reason, userId);

    res.json({
      success: result.success,
      message: result.message,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Cancel error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cancel upload',
      details: error.message
    });
  }
});

// ====================
// BULK OPERATIONS
// ====================

/**
 * POST /api/suppliers/bulk-upload-enhanced
 * Bulk upload multiple price lists
 */
router.post('/bulk-upload-enhanced', [
  uploadRateLimit,
  upload.array('files', 10), // Allow up to 10 files
  body('supplierIds').isArray({ min: 1 }).withMessage('Supplier IDs array required'),
  body('supplierIds.*').isUUID().withMessage('Each supplier ID must be valid UUID'),
  body('options').optional().isJSON().withMessage('Options must be valid JSON'),
  handleValidationErrors
], async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No files uploaded'
      });
    }

    const supplierIds = req.body.supplierIds;
    const options = req.body.options ? JSON.parse(req.body.options) : {};
    const userId = req.user?.sub || 'system';

    if (req.files.length !== supplierIds.length) {
      return res.status(400).json({
        success: false,
        error: 'Number of files must match number of supplier IDs'
      });
    }

    // Prepare upload data array
    const uploadDataArray = req.files.map((file, index) => ({
      file: {
        originalname: file.originalname,
        mimetype: file.mimetype,
        buffer: file.buffer,
        size: file.size
      },
      supplierId: supplierIds[index],
      options: {
        ...options,
        requirePreview: false, // Skip preview for bulk operations
        batchOperation: true
      }
    }));

    const result = await supplierUploadEnhanced.bulkUpload(uploadDataArray, userId);

    res.status(202).json({
      success: result.success,
      batchId: result.summary.batchId,
      summary: result.summary,
      results: result.results,
      message: `Bulk upload completed: ${result.summary.successful}/${result.summary.total} successful`,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Bulk upload error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process bulk upload',
      details: error.message
    });
  }
});

// ====================
// PRICE RULES ENDPOINTS
// ====================

/**
 * POST /api/suppliers/:id/validate-price-rules
 * Validate price rules configuration
 */
router.post('/:id/validate-price-rules', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
  body('rulesConfig').isObject().withMessage('Rules configuration required'),
  handleValidationErrors
], async (req, res) => {
  try {
    const validation = priceRulesEngine.validateRulesConfig(req.body.rulesConfig);

    res.json({
      success: true,
      validation,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Price rules validation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to validate price rules',
      details: error.message
    });
  }
});

/**
 * POST /api/suppliers/:id/preview-price-rules
 * Preview price rules application on sample data
 */
router.post('/:id/preview-price-rules', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
  body('sampleData').isArray({ min: 1, max: 100 }).withMessage('Sample data array required (1-100 items)'),
  body('rulesConfig').isObject().withMessage('Rules configuration required'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { sampleData, rulesConfig } = req.body;
    
    const result = await priceRulesEngine.applyRules(sampleData, rulesConfig);

    res.json({
      success: result.success,
      preview: result.data.slice(0, 10), // Limit preview to 10 items
      summary: result.summary,
      originalSample: sampleData.slice(0, 10),
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Price rules preview error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to preview price rules',
      details: error.message
    });
  }
});

// ====================
// UPLOAD MANAGEMENT ENDPOINTS
// ====================

/**
 * GET /api/suppliers/:id/uploads/history
 * Get upload history for supplier
 */
router.get('/:id/uploads/history', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be 1-100'),
  query('status').optional().isIn(['processing', 'completed', 'failed', 'cancelled']).withMessage('Invalid status'),
  query('dateFrom').optional().isISO8601().withMessage('Invalid date format'),
  query('dateTo').optional().isISO8601().withMessage('Invalid date format'),
  handleValidationErrors
], async (req, res) => {
  try {
    const supplierId = req.params.id;
    const params = {
      supplierId,
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 20,
      status: req.query.status,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo
    };

    // This would use the upload history queries
    const { getUploadHistory } = await import('../db/upload-history-queries.js');
    const result = await getUploadHistory(params);

    res.json({
      success: true,
      uploads: result.uploads,
      pagination: result.pagination,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Upload history error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get upload history',
      details: error.message
    });
  }
});

/**
 * GET /api/suppliers/uploads/statistics
 * Get upload statistics across all suppliers
 */
router.get('/uploads/statistics', [
  generalRateLimit,
  query('dateFrom').optional().isISO8601().withMessage('Invalid date format'),
  query('dateTo').optional().isISO8601().withMessage('Invalid date format'),
  handleValidationErrors
], async (req, res) => {
  try {
    const params = {
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo
    };

    const { getUploadStatistics } = await import('../db/upload-history-queries.js');
    const stats = await getUploadStatistics(params);
    const serviceStats = supplierUploadEnhanced.getStats();

    res.json({
      success: true,
      statistics: {
        database: stats,
        service: serviceStats
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Upload statistics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get upload statistics',
      details: error.message
    });
  }
});

// ====================
// NOTIFICATION ENDPOINTS
// ====================

/**
 * POST /api/suppliers/:id/notifications/test
 * Test notification delivery
 */
router.post('/:id/notifications/test', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
  body('notificationType').isIn(['upload_completed', 'upload_failed', 'requires_approval']).withMessage('Invalid notification type'),
  body('email').optional().isEmail().withMessage('Valid email required'),
  handleValidationErrors
], async (req, res) => {
  try {
    const supplierId = req.params.id;
    const { notificationType, email } = req.body;

    // Create test notification data
    const testData = {
      uploadId: 'test_upload_123',
      priceListId: 'test_price_list_456',
      itemsProcessed: 100,
      supplier: { id: supplierId, companyName: 'Test Supplier', email },
      timestamp: new Date().toISOString()
    };

    const result = await supplierNotificationService.sendUploadNotification({
      ...testData,
      notificationType,
      notifySupplier: true
    });

    res.json({
      success: result.success,
      message: result.success ? 'Test notification sent successfully' : 'Failed to send test notification',
      error: result.error,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Test notification error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send test notification',
      details: error.message
    });
  }
});

/**
 * GET /api/suppliers/notifications/statistics
 * Get notification statistics
 */
router.get('/notifications/statistics', [
  generalRateLimit
], async (req, res) => {
  try {
    const stats = supplierNotificationService.getStats();

    res.json({
      success: true,
      statistics: stats,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Notification statistics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get notification statistics',
      details: error.message
    });
  }
});

// ====================
// TEMPLATE AND SAMPLE ENDPOINTS
// ====================

/**
 * GET /api/suppliers/:id/template/enhanced/:format
 * Download enhanced price list template with price rules examples
 */
router.get('/:id/template/enhanced/:format', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid supplier ID'),
  param('format').isIn(['CSV', 'EXCEL', 'JSON']).withMessage('Format must be CSV, EXCEL, or JSON'),
  query('includePriceRules').optional().isBoolean().withMessage('includePriceRules must be boolean'),
  query('includeTierPricing').optional().isBoolean().withMessage('includeTierPricing must be boolean'),
  handleValidationErrors
], async (req, res) => {
  try {
    const format = req.params.format.toUpperCase();
    const supplierId = req.params.id;
    const includePriceRules = req.query.includePriceRules === 'true';
    const includeTierPricing = req.query.includeTierPricing === 'true';

    // Get supplier info
    const { getSupplierById } = await import('../db/supplier-queries.js');
    const supplier = await getSupplierById(supplierId);
    
    if (!supplier) {
      return res.status(404).json({
        success: false,
        error: 'Supplier not found'
      });
    }

    // Generate enhanced template (implementation would create actual files)
    const templateData = {
      format,
      supplier,
      includePriceRules,
      includeTierPricing,
      generatedAt: new Date().toISOString()
    };

    // Set response headers
    const extension = format === 'CSV' ? '.csv' : format === 'EXCEL' ? '.xlsx' : '.json';
    const filename = `${supplier.supplierCode || 'supplier'}-enhanced-template${extension}`;
    
    res.setHeader('Content-Type', format === 'CSV' ? 'text/csv' : 
                                  format === 'EXCEL' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' :
                                  'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Return template data (in a real implementation, this would generate actual file content)
    res.json({
      success: true,
      templateInfo: templateData,
      message: 'Enhanced template generated'
    });

  } catch (error) {
    console.error('Enhanced template error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate enhanced template',
      details: error.message
    });
  }
});

export default router;