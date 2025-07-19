import express from 'express';
import rateLimit from 'express-rate-limit';
import { body, param, query, validationResult } from 'express-validator';
import * as invoiceQueries from '../db/invoice-queries.js';

const router = express.Router();

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

// Invoice validation rules
const invoiceValidationRules = [
  body('invoiceNumber').optional().isLength({ min: 1, max: 100 }).withMessage('Invoice number must be 1-100 characters'),
  body('supplierId').isUUID().withMessage('Valid supplier ID is required'),
  body('customerId').optional().isUUID().withMessage('Valid customer ID required if provided'),
  body('purchaseOrderId').optional().isUUID().withMessage('Valid purchase order ID required if provided'),
  body('invoiceType').optional().isIn(['purchase', 'sales', 'credit_note', 'debit_note']).withMessage('Invalid invoice type'),
  body('invoiceDate').isISO8601().withMessage('Valid invoice date is required'),
  body('dueDate').isISO8601().withMessage('Valid due date is required'),
  body('subtotal').optional().isFloat({ min: 0 }).withMessage('Subtotal must be non-negative'),
  body('taxAmount').optional().isFloat({ min: 0 }).withMessage('Tax amount must be non-negative'),
  body('shippingCost').optional().isFloat({ min: 0 }).withMessage('Shipping cost must be non-negative'),
  body('discountAmount').optional().isFloat({ min: 0 }).withMessage('Discount amount must be non-negative'),
  body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
  body('items.*.productId').optional().isUUID().withMessage('Valid product ID required'),
  body('items.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be positive'),
  body('items.*.unitPrice').isFloat({ min: 0 }).withMessage('Unit price must be non-negative'),
  body('items.*.productName').isLength({ min: 1, max: 255 }).withMessage('Product name is required'),
  body('paymentTerms').optional().isObject().withMessage('Payment terms must be an object'),
  body('billingAddress').optional().isObject().withMessage('Billing address must be an object'),
  body('shippingAddress').optional().isObject().withMessage('Shipping address must be an object')
];

const paymentValidationRules = [
  body('paymentMethod').isIn(['bank_transfer', 'check', 'cash', 'credit_card', 'eft', 'wire_transfer']).withMessage('Valid payment method is required'),
  body('paymentAmount').isFloat({ min: 0.01 }).withMessage('Payment amount must be positive'),
  body('paymentDate').isISO8601().withMessage('Valid payment date is required'),
  body('bankReference').optional().isLength({ max: 100 }).withMessage('Bank reference too long'),
  body('checkNumber').optional().isLength({ max: 50 }).withMessage('Check number too long'),
  body('transactionId').optional().isLength({ max: 100 }).withMessage('Transaction ID too long')
];

// ==================== INVOICE CRUD ENDPOINTS ====================

/**
 * GET /api/invoices
 * Get all invoices with filtering and pagination
 */
router.get('/', [
  generalRateLimit,
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be 1-100'),
  query('search').optional().isLength({ max: 255 }).withMessage('Search term too long'),
  query('status').optional().isIn(['draft', 'pending', 'approved', 'paid', 'overdue', 'cancelled', 'disputed']).withMessage('Invalid status'),
  query('invoiceType').optional().isIn(['purchase', 'sales', 'credit_note', 'debit_note']).withMessage('Invalid invoice type'),
  query('supplierId').optional().isUUID().withMessage('Invalid supplier ID'),
  query('customerId').optional().isUUID().withMessage('Invalid customer ID'),
  query('dateFrom').optional().isISO8601().withMessage('Invalid date format'),
  query('dateTo').optional().isISO8601().withMessage('Invalid date format'),
  query('sortBy').optional().isIn(['invoiceNumber', 'invoiceDate', 'dueDate', 'totalAmount', 'status', 'createdAt']).withMessage('Invalid sort field'),
  query('sortOrder').optional().isIn(['asc', 'desc']).withMessage('Sort order must be asc or desc'),
  handleValidationErrors
], async (req, res) => {
  try {
    const params = {
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 10,
      search: req.query.search || '',
      status: req.query.status || null,
      invoiceType: req.query.invoiceType || null,
      supplierId: req.query.supplierId || null,
      customerId: req.query.customerId || null,
      dateFrom: req.query.dateFrom || null,
      dateTo: req.query.dateTo || null,
      sortBy: req.query.sortBy || 'createdAt',
      sortOrder: req.query.sortOrder || 'desc'
    };
    
    const result = await invoiceQueries.getInvoices(params);
    
    res.json({
      success: true,
      data: result.invoices,
      pagination: result.pagination,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error fetching invoices:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch invoices',
      details: err.message 
    });
  }
});

/**
 * GET /api/invoices/:id
 * Get invoice by ID with full details
 */
router.get('/:id', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid invoice ID'),
  handleValidationErrors
], async (req, res) => {
  try {
    const invoice = await invoiceQueries.getInvoiceById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ 
        success: false,
        error: 'Invoice not found' 
      });
    }
    
    res.json({
      success: true,
      data: invoice,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error fetching invoice:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch invoice',
      details: err.message 
    });
  }
});

/**
 * POST /api/invoices
 * Create new invoice
 */
router.post('/', [
  generalRateLimit,
  ...invoiceValidationRules,
  handleValidationErrors
], async (req, res) => {
  try {
    // Check if invoice number already exists
    if (req.body.invoiceNumber) {
      const exists = await invoiceQueries.invoiceNumberExists(req.body.invoiceNumber);
      if (exists) {
        return res.status(409).json({
          success: false,
          error: 'Invoice number already exists'
        });
      }
    }

    const invoice = await invoiceQueries.createInvoice({
      ...req.body,
      createdBy: req.user?.sub
    });
    
    res.status(201).json({
      success: true,
      data: invoice,
      message: 'Invoice created successfully',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error creating invoice:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to create invoice',
      details: err.message 
    });
  }
});

/**
 * PUT /api/invoices/:id
 * Update invoice
 */
router.put('/:id', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid invoice ID'),
  body('invoiceNumber').optional().isLength({ min: 1, max: 100 }).withMessage('Invoice number must be 1-100 characters'),
  body('status').optional().isIn(['draft', 'pending', 'approved', 'paid', 'overdue', 'cancelled', 'disputed']).withMessage('Invalid status'),
  body('invoiceDate').optional().isISO8601().withMessage('Valid invoice date required'),
  body('dueDate').optional().isISO8601().withMessage('Valid due date required'),
  body('items').optional().isArray().withMessage('Items must be an array'),
  handleValidationErrors
], async (req, res) => {
  try {
    // Check if invoice number already exists (excluding current invoice)
    if (req.body.invoiceNumber) {
      const exists = await invoiceQueries.invoiceNumberExists(req.body.invoiceNumber, req.params.id);
      if (exists) {
        return res.status(409).json({
          success: false,
          error: 'Invoice number already exists'
        });
      }
    }

    const invoice = await invoiceQueries.updateInvoice(req.params.id, {
      ...req.body,
      updatedBy: req.user?.sub
    });
    
    res.json({
      success: true,
      data: invoice,
      message: 'Invoice updated successfully',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error updating invoice:', err);
    if (err.message === 'Invoice not found') {
      return res.status(404).json({ 
        success: false,
        error: 'Invoice not found' 
      });
    }
    res.status(500).json({ 
      success: false,
      error: 'Failed to update invoice',
      details: err.message 
    });
  }
});

/**
 * DELETE /api/invoices/:id
 * Cancel invoice (soft delete)
 */
router.delete('/:id', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid invoice ID'),
  handleValidationErrors
], async (req, res) => {
  try {
    const invoice = await invoiceQueries.deleteInvoice(req.params.id);
    if (!invoice) {
      return res.status(404).json({ 
        success: false,
        error: 'Invoice not found' 
      });
    }
    
    res.json({
      success: true,
      message: 'Invoice cancelled successfully',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error cancelling invoice:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to cancel invoice',
      details: err.message 
    });
  }
});

// ==================== PAYMENT ENDPOINTS ====================

/**
 * POST /api/invoices/:id/payments
 * Record payment for invoice
 */
router.post('/:id/payments', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid invoice ID'),
  ...paymentValidationRules,
  handleValidationErrors
], async (req, res) => {
  try {
    const payment = await invoiceQueries.recordPayment({
      ...req.body,
      invoiceId: req.params.id,
      createdBy: req.user?.sub
    });
    
    res.status(201).json({
      success: true,
      data: payment,
      message: 'Payment recorded successfully',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error recording payment:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to record payment',
      details: err.message 
    });
  }
});

/**
 * GET /api/invoices/:id/payments
 * Get payment history for invoice
 */
router.get('/:id/payments', [
  generalRateLimit,
  param('id').isUUID().withMessage('Invalid invoice ID'),
  handleValidationErrors
], async (req, res) => {
  try {
    const payments = await invoiceQueries.getPaymentHistory(req.params.id);
    
    res.json({
      success: true,
      data: payments,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error fetching payment history:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch payment history',
      details: err.message 
    });
  }
});

// ==================== PURCHASE ORDER INTEGRATION ====================

/**
 * GET /api/invoices/purchase-orders/:supplierId
 * Get purchase orders available for invoicing
 */
router.get('/purchase-orders/:supplierId', [
  generalRateLimit,
  param('supplierId').isUUID().withMessage('Invalid supplier ID'),
  handleValidationErrors
], async (req, res) => {
  try {
    const purchaseOrders = await invoiceQueries.getPurchaseOrdersForInvoicing(req.params.supplierId);
    
    res.json({
      success: true,
      data: purchaseOrders,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error fetching purchase orders:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch purchase orders',
      details: err.message 
    });
  }
});

/**
 * GET /api/invoices/purchase-order-items/:purchaseOrderId
 * Get purchase order items for invoicing
 */
router.get('/purchase-order-items/:purchaseOrderId', [
  generalRateLimit,
  param('purchaseOrderId').isUUID().withMessage('Invalid purchase order ID'),
  handleValidationErrors
], async (req, res) => {
  try {
    const items = await invoiceQueries.getPurchaseOrderItems(req.params.purchaseOrderId);
    
    res.json({
      success: true,
      data: items,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error fetching purchase order items:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch purchase order items',
      details: err.message 
    });
  }
});

// ==================== ANALYTICS ENDPOINTS ====================

/**
 * GET /api/invoices/analytics/overview
 * Get invoice analytics and reporting
 */
router.get('/analytics/overview', [
  generalRateLimit,
  query('dateFrom').optional().isISO8601().withMessage('Invalid date format'),
  query('dateTo').optional().isISO8601().withMessage('Invalid date format'),
  query('supplierId').optional().isUUID().withMessage('Invalid supplier ID'),
  query('customerId').optional().isUUID().withMessage('Invalid customer ID'),
  handleValidationErrors
], async (req, res) => {
  try {
    const params = {
      dateFrom: req.query.dateFrom || null,
      dateTo: req.query.dateTo || null,
      supplierId: req.query.supplierId || null,
      customerId: req.query.customerId || null
    };
    
    const analytics = await invoiceQueries.getInvoiceAnalytics(params);
    
    res.json({
      success: true,
      data: analytics,
      metadata: {
        ...params,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('Error fetching invoice analytics:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch invoice analytics',
      details: err.message 
    });
  }
});

/**
 * GET /api/invoices/status/overdue
 * Get overdue invoices
 */
router.get('/status/overdue', [
  generalRateLimit,
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be 1-100'),
  handleValidationErrors
], async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const analytics = await invoiceQueries.getInvoiceAnalytics({});
    
    res.json({
      success: true,
      data: analytics.overdueInvoices.slice(0, limit),
      total: analytics.overdueInvoices.length,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error fetching overdue invoices:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch overdue invoices',
      details: err.message 
    });
  }
});

export default router;