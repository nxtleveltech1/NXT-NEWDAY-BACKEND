import express from 'express';
import SupplierPurchaseOrderService from '../services/supplier-purchase-order.service.js';
import { validateRequest, handleAsync } from '../utils/middleware.js';
import { body, param, query } from 'express-validator';

const router = express.Router();

// ==================== VALIDATION SCHEMAS ====================

const createPurchaseOrderValidation = [
  body('supplierId').isUUID().withMessage('Valid supplier ID is required'),
  body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
  body('items.*.sku').notEmpty().withMessage('SKU is required for each item'),
  body('items.*.productName').notEmpty().withMessage('Product name is required for each item'),
  body('items.*.quantityOrdered').isInt({ min: 1 }).withMessage('Quantity must be a positive integer'),
  body('items.*.unitPrice').isFloat({ min: 0 }).withMessage('Unit price must be a positive number'),
  body('expectedDeliveryDate').optional().isISO8601().withMessage('Expected delivery date must be valid'),
  body('deliveryAddress').optional().isObject().withMessage('Delivery address must be an object'),
  body('notes').optional().isString().withMessage('Notes must be a string')
];

const createFromPriceListValidation = [
  body('supplierId').isUUID().withMessage('Valid supplier ID is required'),
  body('priceListId').isUUID().withMessage('Valid price list ID is required'),
  body('selectedItems').isArray({ min: 1 }).withMessage('At least one item must be selected'),
  body('selectedItems.*.priceListItemId').isUUID().withMessage('Valid price list item ID is required'),
  body('selectedItems.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be a positive integer'),
  body('expectedDeliveryDate').optional().isISO8601().withMessage('Expected delivery date must be valid')
];

const updateStatusValidation = [
  param('id').isUUID().withMessage('Valid purchase order ID is required'),
  body('status').isIn([
    'draft', 'pending_approval', 'approved', 'sent', 'acknowledged', 
    'in_transit', 'delivered', 'completed', 'cancelled', 'rejected'
  ]).withMessage('Invalid status'),
  body('notes').optional().isString().withMessage('Notes must be a string')
];

const createReceiptValidation = [
  param('id').isUUID().withMessage('Valid purchase order ID is required'),
  body('receivedItems').isArray({ min: 1 }).withMessage('At least one item must be received'),
  body('receivedItems.*.supplierPurchaseOrderItemId').isUUID().withMessage('Valid order item ID is required'),
  body('receivedItems.*.quantityReceived').isInt({ min: 0 }).withMessage('Quantity received must be non-negative'),
  body('receivedItems.*.quantityAccepted').isInt({ min: 0 }).withMessage('Quantity accepted must be non-negative'),
  body('receivedItems.*.quantityRejected').optional().isInt({ min: 0 }).withMessage('Quantity rejected must be non-negative'),
  body('carrierName').optional().isString().withMessage('Carrier name must be a string'),
  body('trackingNumber').optional().isString().withMessage('Tracking number must be a string')
];

// ==================== ROUTES ====================

/**
 * @route   POST /api/supplier-purchase-orders
 * @desc    Create a new supplier purchase order
 * @access  Private
 */
router.post('/', 
  createPurchaseOrderValidation,
  validateRequest,
  handleAsync(async (req, res) => {
    const userId = req.user?.id || 'system'; // Get from auth middleware
    const result = await SupplierPurchaseOrderService.createPurchaseOrder(req.body, userId);
    
    res.status(201).json({
      success: true,
      data: result.data,
      message: result.message
    });
  })
);

/**
 * @route   POST /api/supplier-purchase-orders/from-price-list
 * @desc    Create purchase order from price list
 * @access  Private
 */
router.post('/from-price-list',
  createFromPriceListValidation,
  validateRequest,
  handleAsync(async (req, res) => {
    const { supplierId, priceListId, selectedItems, ...orderOptions } = req.body;
    const userId = req.user?.id || 'system';

    const result = await SupplierPurchaseOrderService.createPurchaseOrderFromPriceList(
      supplierId, 
      priceListId, 
      selectedItems, 
      orderOptions, 
      userId
    );

    res.status(201).json({
      success: true,
      data: result.data,
      message: result.message
    });
  })
);

/**
 * @route   GET /api/supplier-purchase-orders
 * @desc    Get supplier purchase orders with filtering and pagination
 * @access  Private
 */
router.get('/',
  [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    query('supplierId').optional().isUUID().withMessage('Supplier ID must be valid UUID'),
    query('status').optional().isString().withMessage('Status must be a string'),
    query('approvalStatus').optional().isString().withMessage('Approval status must be a string'),
    query('dateFrom').optional().isISO8601().withMessage('Date from must be valid ISO date'),
    query('dateTo').optional().isISO8601().withMessage('Date to must be valid ISO date')
  ],
  validateRequest,
  handleAsync(async (req, res) => {
    const filters = {
      supplierId: req.query.supplierId,
      status: req.query.status,
      approvalStatus: req.query.approvalStatus,
      dateFrom: req.query.dateFrom ? new Date(req.query.dateFrom) : undefined,
      dateTo: req.query.dateTo ? new Date(req.query.dateTo) : undefined,
      limit: parseInt(req.query.limit) || 50,
      offset: ((parseInt(req.query.page) || 1) - 1) * (parseInt(req.query.limit) || 50),
      orderBy: req.query.orderBy || 'created_at',
      orderDirection: req.query.orderDirection || 'desc'
    };

    const result = await SupplierPurchaseOrderService.getPurchaseOrders(filters);

    res.json({
      success: true,
      data: result.data,
      pagination: result.pagination,
      filters: result.filters
    });
  })
);

/**
 * @route   GET /api/supplier-purchase-orders/dashboard
 * @desc    Get dashboard data for procurement overview
 * @access  Private
 */
router.get('/dashboard',
  handleAsync(async (req, res) => {
    const result = await SupplierPurchaseOrderService.getDashboardData();

    res.json({
      success: true,
      data: result.data
    });
  })
);

/**
 * @route   GET /api/supplier-purchase-orders/analytics
 * @desc    Get purchase order analytics
 * @access  Private
 */
router.get('/analytics',
  [
    query('dateFrom').optional().isISO8601().withMessage('Date from must be valid ISO date'),
    query('dateTo').optional().isISO8601().withMessage('Date to must be valid ISO date'),
    query('supplierId').optional().isUUID().withMessage('Supplier ID must be valid UUID')
  ],
  validateRequest,
  handleAsync(async (req, res) => {
    const filters = {
      dateFrom: req.query.dateFrom ? new Date(req.query.dateFrom) : undefined,
      dateTo: req.query.dateTo ? new Date(req.query.dateTo) : undefined,
      supplierId: req.query.supplierId
    };

    const result = await SupplierPurchaseOrderService.getAnalytics(filters);

    res.json({
      success: true,
      data: result.data,
      generatedAt: result.generatedAt
    });
  })
);

/**
 * @route   GET /api/supplier-purchase-orders/pending-approvals
 * @desc    Get purchase orders pending approval
 * @access  Private
 */
router.get('/pending-approvals',
  handleAsync(async (req, res) => {
    const result = await SupplierPurchaseOrderService.getPendingApprovals();

    res.json({
      success: true,
      data: result
    });
  })
);

/**
 * @route   GET /api/supplier-purchase-orders/ready-for-receiving
 * @desc    Get purchase orders ready for receiving
 * @access  Private
 */
router.get('/ready-for-receiving',
  handleAsync(async (req, res) => {
    const result = await SupplierPurchaseOrderService.getOrdersReadyForReceiving();

    res.json({
      success: true,
      data: result
    });
  })
);

/**
 * @route   GET /api/supplier-purchase-orders/reorder-suggestions
 * @desc    Generate automatic reorder suggestions
 * @access  Private
 */
router.get('/reorder-suggestions',
  handleAsync(async (req, res) => {
    const criteria = {
      warehouseId: req.query.warehouseId,
      categoryId: req.query.categoryId,
      supplierId: req.query.supplierId
    };

    const result = await SupplierPurchaseOrderService.generateReorderSuggestions(criteria);

    res.json({
      success: true,
      data: result.data,
      generatedAt: result.generatedAt
    });
  })
);

/**
 * @route   GET /api/supplier-purchase-orders/:id
 * @desc    Get supplier purchase order by ID
 * @access  Private
 */
router.get('/:id',
  [param('id').isUUID().withMessage('Valid purchase order ID is required')],
  validateRequest,
  handleAsync(async (req, res) => {
    const result = await SupplierPurchaseOrderService.getPurchaseOrderById(req.params.id);

    if (!result.success) {
      return res.status(404).json({
        success: false,
        message: result.message
      });
    }

    res.json({
      success: true,
      data: result.data
    });
  })
);

/**
 * @route   PUT /api/supplier-purchase-orders/:id/status
 * @desc    Update purchase order status
 * @access  Private
 */
router.put('/:id/status',
  updateStatusValidation,
  validateRequest,
  handleAsync(async (req, res) => {
    const { status, ...additionalData } = req.body;
    const userId = req.user?.id || 'system';

    const result = await SupplierPurchaseOrderService.updatePurchaseOrderStatus(
      req.params.id,
      status,
      additionalData,
      userId
    );

    res.json({
      success: true,
      data: result.data,
      message: result.message
    });
  })
);

/**
 * @route   POST /api/supplier-purchase-orders/:id/approve
 * @desc    Approve purchase order
 * @access  Private
 */
router.post('/:id/approve',
  [
    param('id').isUUID().withMessage('Valid purchase order ID is required'),
    body('notes').optional().isString().withMessage('Notes must be a string')
  ],
  validateRequest,
  handleAsync(async (req, res) => {
    const userId = req.user?.id || 'system';

    const result = await SupplierPurchaseOrderService.updatePurchaseOrderStatus(
      req.params.id,
      'approved',
      { approvedBy: userId, notes: req.body.notes },
      userId
    );

    res.json({
      success: true,
      data: result.data,
      message: 'Purchase order approved successfully'
    });
  })
);

/**
 * @route   POST /api/supplier-purchase-orders/:id/reject
 * @desc    Reject purchase order
 * @access  Private
 */
router.post('/:id/reject',
  [
    param('id').isUUID().withMessage('Valid purchase order ID is required'),
    body('reason').notEmpty().withMessage('Rejection reason is required')
  ],
  validateRequest,
  handleAsync(async (req, res) => {
    const userId = req.user?.id || 'system';

    const result = await SupplierPurchaseOrderService.updatePurchaseOrderStatus(
      req.params.id,
      'rejected',
      { 
        rejectedBy: userId, 
        rejectionReason: req.body.reason,
        notes: req.body.notes 
      },
      userId
    );

    res.json({
      success: true,
      data: result.data,
      message: 'Purchase order rejected'
    });
  })
);

/**
 * @route   POST /api/supplier-purchase-orders/:id/receipts
 * @desc    Create receipt for purchase order
 * @access  Private
 */
router.post('/:id/receipts',
  createReceiptValidation,
  validateRequest,
  handleAsync(async (req, res) => {
    const { receivedItems, ...receiptData } = req.body;
    const userId = req.user?.id || 'system';

    const result = await SupplierPurchaseOrderService.createReceipt(
      req.params.id,
      receiptData,
      receivedItems,
      userId
    );

    res.status(201).json({
      success: true,
      data: result.data,
      message: result.message
    });
  })
);

/**
 * @route   POST /api/supplier-purchase-orders/receipts/:receiptId/process
 * @desc    Process receipt and update inventory
 * @access  Private
 */
router.post('/receipts/:receiptId/process',
  [param('receiptId').isUUID().withMessage('Valid receipt ID is required')],
  validateRequest,
  handleAsync(async (req, res) => {
    const userId = req.user?.id || 'system';

    const result = await SupplierPurchaseOrderService.processReceiptToInventory(
      req.params.receiptId,
      userId
    );

    res.json({
      success: true,
      data: result.data,
      message: result.message
    });
  })
);

/**
 * @route   PUT /api/supplier-purchase-orders/items/:itemId/quantities
 * @desc    Update purchase order item quantities
 * @access  Private
 */
router.put('/items/:itemId/quantities',
  [
    param('itemId').isUUID().withMessage('Valid item ID is required'),
    body('quantityOrdered').optional().isInt({ min: 0 }).withMessage('Quantity must be non-negative'),
    body('quantityReceived').optional().isInt({ min: 0 }).withMessage('Quantity received must be non-negative'),
    body('quantityAccepted').optional().isInt({ min: 0 }).withMessage('Quantity accepted must be non-negative'),
    body('quantityRejected').optional().isInt({ min: 0 }).withMessage('Quantity rejected must be non-negative')
  ],
  validateRequest,
  handleAsync(async (req, res) => {
    const result = await updatePurchaseOrderItemQuantities(req.params.itemId, req.body);

    res.json({
      success: true,
      data: result,
      message: 'Item quantities updated successfully'
    });
  })
);

// ==================== ERROR HANDLING ====================

router.use((error, req, res, next) => {
  console.error('Supplier Purchase Order Route Error:', error);

  if (error.message.includes('Validation failed')) {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: error.details
    });
  }

  if (error.message.includes('not found')) {
    return res.status(404).json({
      success: false,
      message: error.message
    });
  }

  if (error.message.includes('permission') || error.message.includes('authorization')) {
    return res.status(403).json({
      success: false,
      message: error.message
    });
  }

  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
});

export default router;