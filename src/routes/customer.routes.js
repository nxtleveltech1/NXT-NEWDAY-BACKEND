import express from 'express';
import { CustomerService } from '../services/customer.service.js';

const router = express.Router();

/**
 * @swagger
 * /api/customers:
 *   get:
 *     summary: Get all customers with pagination and search
 *     tags: [Customers]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Number of items per page
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search term for company name, email, or customer code
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           default: createdAt
 *         description: Field to sort by
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Sort order
 *     responses:
 *       200:
 *         description: List of customers retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     customers:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Customer'
 *                     pagination:
 *                       $ref: '#/components/schemas/Pagination'
 *       500:
 *         description: Server error
 */
router.get('/', async (req, res) => {
  try {
    const {
      page = 1,
      pageSize = 10,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const options = {
      page: parseInt(page),
      pageSize: parseInt(pageSize),
      search,
      sortBy,
      sortOrder
    };

    const result = await CustomerService.getAllCustomers(options);

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Error in GET /customers:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to retrieve customers'
    });
  }
});

/**
 * @swagger
 * /api/customers/{id}:
 *   get:
 *     summary: Get customer by ID
 *     tags: [Customers]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Customer ID
 *     responses:
 *       200:
 *         description: Customer retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Customer'
 *       404:
 *         description: Customer not found
 *       500:
 *         description: Server error
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await CustomerService.getCustomerById(id);

    if (result.success) {
      res.json(result);
    } else {
      res.status(404).json(result);
    }
  } catch (error) {
    console.error('Error in GET /customers/:id:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to retrieve customer'
    });
  }
});

/**
 * @swagger
 * /api/customers:
 *   post:
 *     summary: Create a new customer
 *     tags: [Customers]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - customerCode
 *               - companyName
 *               - email
 *             properties:
 *               customerCode:
 *                 type: string
 *                 description: Unique customer code
 *               companyName:
 *                 type: string
 *                 description: Company name
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Customer email
 *               phone:
 *                 type: string
 *                 description: Customer phone number
 *               address:
 *                 type: object
 *                 description: Customer address
 *               metadata:
 *                 type: object
 *                 description: Customer metadata (4 sets)
 *     responses:
 *       201:
 *         description: Customer created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Customer'
 *                 message:
 *                   type: string
 *       400:
 *         description: Bad request - validation error
 *       500:
 *         description: Server error
 */
router.post('/', async (req, res) => {
  try {
    const result = await CustomerService.createCustomer(req.body);

    if (result.success) {
      res.status(201).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Error in POST /customers:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to create customer'
    });
  }
});

/**
 * @swagger
 * /api/customers/{id}:
 *   put:
 *     summary: Update customer
 *     tags: [Customers]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Customer ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               customerCode:
 *                 type: string
 *               companyName:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               phone:
 *                 type: string
 *               address:
 *                 type: object
 *               metadata:
 *                 type: object
 *     responses:
 *       200:
 *         description: Customer updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Customer'
 *                 message:
 *                   type: string
 *       400:
 *         description: Bad request - validation error
 *       404:
 *         description: Customer not found
 *       500:
 *         description: Server error
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await CustomerService.updateCustomer(id, req.body);

    if (result.success) {
      res.json(result);
    } else {
      res.status(result.error === 'Customer not found' ? 404 : 400).json(result);
    }
  } catch (error) {
    console.error('Error in PUT /customers/:id:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to update customer'
    });
  }
});

/**
 * @swagger
 * /api/customers/{id}:
 *   delete:
 *     summary: Delete customer (soft delete)
 *     tags: [Customers]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Customer ID
 *     responses:
 *       200:
 *         description: Customer deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       404:
 *         description: Customer not found
 *       500:
 *         description: Server error
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await CustomerService.deleteCustomer(id);

    if (result.success) {
      res.json(result);
    } else {
      res.status(404).json(result);
    }
  } catch (error) {
    console.error('Error in DELETE /customers/:id:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to delete customer'
    });
  }
});

/**
 * @swagger
 * /api/customers/{id}/metadata:
 *   get:
 *     summary: Get customer metadata
 *     tags: [Customers]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Customer ID
 *     responses:
 *       200:
 *         description: Customer metadata retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *       404:
 *         description: Customer not found
 *       500:
 *         description: Server error
 */
router.get('/:id/metadata', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await CustomerService.getCustomerById(id);

    if (result.success) {
      res.json({
        success: true,
        data: result.data.metadata || {}
      });
    } else {
      res.status(404).json(result);
    }
  } catch (error) {
    console.error('Error in GET /customers/:id/metadata:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to retrieve customer metadata'
    });
  }
});

/**
 * @swagger
 * /api/customers/{id}/metadata:
 *   put:
 *     summary: Update customer metadata
 *     tags: [Customers]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Customer ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               basicInfo:
 *                 type: object
 *                 description: Basic information metadata
 *               businessInfo:
 *                 type: object
 *                 description: Business information metadata
 *               preferences:
 *                 type: object
 *                 description: Customer preferences
 *               customFields:
 *                 type: object
 *                 description: Custom fields
 *     responses:
 *       200:
 *         description: Customer metadata updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Customer'
 *                 message:
 *                   type: string
 *       400:
 *         description: Bad request - validation error
 *       404:
 *         description: Customer not found
 *       500:
 *         description: Server error
 */
router.put('/:id/metadata', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await CustomerService.updateCustomerMetadata(id, req.body);

    if (result.success) {
      res.json(result);
    } else {
      res.status(result.error === 'Customer not found' ? 404 : 400).json(result);
    }
  } catch (error) {
    console.error('Error in PUT /customers/:id/metadata:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to update customer metadata'
    });
  }
});

/**
 * @swagger
 * /api/customers/{id}/analytics:
 *   get:
 *     summary: Get customer analytics
 *     tags: [Customers]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Customer ID
 *     responses:
 *       200:
 *         description: Customer analytics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *       404:
 *         description: Customer not found
 *       500:
 *         description: Server error
 */
router.get('/:id/analytics', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await CustomerService.getCustomerAnalytics(id);

    if (result.success) {
      res.json(result);
    } else {
      res.status(404).json(result);
    }
  } catch (error) {
    console.error('Error in GET /customers/:id/analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to retrieve customer analytics'
    });
  }
});

/**
 * @swagger
 * /api/customers/{id}/sales:
 *   post:
 *     summary: Process a sale for customer
 *     tags: [Customers]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Customer ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - items
 *             properties:
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     productId:
 *                       type: string
 *                     warehouseId:
 *                       type: string
 *                     quantity:
 *                       type: number
 *                     unitPrice:
 *                       type: number
 *               referenceNumber:
 *                 type: string
 *               performedBy:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Sale processed successfully
 *       400:
 *         description: Bad request - validation error
 *       500:
 *         description: Server error
 */
router.post('/:id/sales', async (req, res) => {
  try {
    const { id } = req.params;
    const saleData = {
      customerId: id,
      ...req.body
    };

    const result = await CustomerService.processSale(saleData);

    if (result.success) {
      res.status(201).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Error in POST /customers/:id/sales:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to process sale'
    });
  }
});

/**
 * @swagger
 * /api/customers/{id}/reserve:
 *   post:
 *     summary: Reserve stock for customer
 *     tags: [Customers]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Customer ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - items
 *             properties:
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     productId:
 *                       type: string
 *                     warehouseId:
 *                       type: string
 *                     quantity:
 *                       type: number
 *     responses:
 *       201:
 *         description: Stock reserved successfully
 *       400:
 *         description: Bad request - validation error
 *       500:
 *         description: Server error
 */
router.post('/:id/reserve', async (req, res) => {
  try {
    const { id } = req.params;
    const { items } = req.body;

    const result = await CustomerService.reserveStock(id, items);

    if (result.success) {
      res.status(201).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Error in POST /customers/:id/reserve:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to reserve stock'
    });
  }
});

/**
 * @swagger
 * /api/customers/{id}/release:
 *   post:
 *     summary: Release reserved stock for customer
 *     tags: [Customers]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Customer ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - items
 *             properties:
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     productId:
 *                       type: string
 *                     warehouseId:
 *                       type: string
 *                     quantity:
 *                       type: number
 *     responses:
 *       200:
 *         description: Stock reservation released successfully
 *       400:
 *         description: Bad request - validation error
 *       500:
 *         description: Server error
 */
router.post('/:id/release', async (req, res) => {
  try {
    const { id } = req.params;
    const { items } = req.body;

    const result = await CustomerService.releaseReservation(id, items);

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Error in POST /customers/:id/release:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to release stock reservation'
    });
  }
});

/**
 * @swagger
 * /api/customers/{id}/backorders:
 *   get:
 *     summary: Get customer backorders
 *     tags: [Customers]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Customer ID
 *     responses:
 *       200:
 *         description: Customer backorders retrieved successfully
 *       404:
 *         description: Customer not found
 *       500:
 *         description: Server error
 */
router.get('/:id/backorders', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await CustomerService.getCustomerBackorders(id);

    if (result.success) {
      res.json(result);
    } else {
      res.status(404).json(result);
    }
  } catch (error) {
    console.error('Error in GET /customers/:id/backorders:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to retrieve customer backorders'
    });
  }
});

/**
 * @swagger
 * /api/customers/search:
 *   get:
 *     summary: Search customers
 *     tags: [Customers]
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Search term
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Number of items per page
 *     responses:
 *       200:
 *         description: Search results retrieved successfully
 *       400:
 *         description: Bad request - search term required
 *       500:
 *         description: Server error
 */
router.get('/search', async (req, res) => {
  try {
    const { q: searchTerm, page = 1, pageSize = 10 } = req.query;

    if (!searchTerm) {
      return res.status(400).json({
        success: false,
        error: 'Search term is required',
        message: 'Please provide a search term'
      });
    }

    const options = {
      page: parseInt(page),
      pageSize: parseInt(pageSize)
    };

    const result = await CustomerService.searchCustomers(searchTerm, options);

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Error in GET /customers/search:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to search customers'
    });
  }
});

/**
 * @swagger
 * /api/customers/analytics/overview:
 *   get:
 *     summary: Get customers analytics overview
 *     tags: [Customers]
 *     parameters:
 *       - in: query
 *         name: dateFrom
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date filter
 *       - in: query
 *         name: dateTo
 *         schema:
 *           type: string
 *           format: date
 *         description: End date filter
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Limit for results
 *     responses:
 *       200:
 *         description: Analytics overview retrieved successfully
 *       500:
 *         description: Server error
 */
router.get('/analytics/overview', async (req, res) => {
  try {
    const { dateFrom, dateTo, limit = 50 } = req.query;
    const params = {
      dateFrom,
      dateTo,
      limit: parseInt(limit)
    };

    const result = await CustomerService.getAnalyticsOverview(params);

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Error in GET /customers/analytics/overview:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to retrieve analytics overview'
    });
  }
});

/**
 * @swagger
 * /api/customers/analytics/segmentation:
 *   get:
 *     summary: Get customer segmentation analysis
 *     tags: [Customers]
 *     responses:
 *       200:
 *         description: Customer segmentation retrieved successfully
 *       500:
 *         description: Server error
 */
router.get('/analytics/segmentation', async (req, res) => {
  try {
    const result = await CustomerService.getCustomerSegmentation();

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Error in GET /customers/analytics/segmentation:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to retrieve customer segmentation'
    });
  }
});

/**
 * @swagger
 * /api/customers/{id}/purchase-history:
 *   get:
 *     summary: Get comprehensive customer purchase history
 *     tags: [Customers]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Customer ID
 *       - in: query
 *         name: dateFrom
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date filter
 *       - in: query
 *         name: dateTo
 *         schema:
 *           type: string
 *           format: date
 *         description: End date filter
 *     responses:
 *       200:
 *         description: Customer purchase history retrieved successfully
 *       404:
 *         description: Customer not found
 *       500:
 *         description: Server error
 */
router.get('/:id/purchase-history', async (req, res) => {
  try {
    const { id } = req.params;
    const { dateFrom, dateTo } = req.query;
    const params = { dateFrom, dateTo };

    const result = await CustomerService.getCustomerPurchaseHistory(id, params);

    if (result.success) {
      res.json(result);
    } else {
      res.status(result.error === 'Customer not found' ? 404 : 400).json(result);
    }
  } catch (error) {
    console.error('Error in GET /customers/:id/purchase-history:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to retrieve customer purchase history'
    });
  }
});

/**
 * @swagger
 * /api/customers/{id}/purchase-orders:
 *   get:
 *     summary: Get customer purchase orders
 *     tags: [Customers]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Customer ID
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Number of items per page
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter by order status
 *       - in: query
 *         name: paymentStatus
 *         schema:
 *           type: string
 *         description: Filter by payment status
 *     responses:
 *       200:
 *         description: Customer purchase orders retrieved successfully
 *       404:
 *         description: Customer not found
 *       500:
 *         description: Server error
 */
router.get('/:id/purchase-orders', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      page = 1,
      pageSize = 10,
      status,
      paymentStatus,
      dateFrom,
      dateTo,
      sortBy = 'orderDate',
      sortOrder = 'desc'
    } = req.query;

    const params = {
      page: parseInt(page),
      pageSize: parseInt(pageSize),
      status,
      paymentStatus,
      dateFrom,
      dateTo,
      sortBy,
      sortOrder
    };

    const result = await CustomerService.getCustomerPurchaseOrders(id, params);

    if (result.success) {
      res.json(result);
    } else {
      res.status(result.error === 'Customer not found' ? 404 : 400).json(result);
    }
  } catch (error) {
    console.error('Error in GET /customers/:id/purchase-orders:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to retrieve customer purchase orders'
    });
  }
});

/**
 * @swagger
 * /api/customers/{id}/purchase-orders:
 *   post:
 *     summary: Create a new purchase order for customer
 *     tags: [Customers]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Customer ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - items
 *             properties:
 *               orderNumber:
 *                 type: string
 *                 description: Order number (auto-generated if not provided)
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     productId:
 *                       type: string
 *                     sku:
 *                       type: string
 *                     productName:
 *                       type: string
 *                     quantity:
 *                       type: number
 *                     unitPrice:
 *                       type: number
 *                     discountPercent:
 *                       type: number
 *                     taxRate:
 *                       type: number
 *               shippingAddress:
 *                 type: object
 *               billingAddress:
 *                 type: object
 *               notes:
 *                 type: string
 *               referenceNumber:
 *                 type: string
 *     responses:
 *       201:
 *         description: Purchase order created successfully
 *       400:
 *         description: Bad request - validation error
 *       404:
 *         description: Customer not found
 *       500:
 *         description: Server error
 */
router.post('/:id/purchase-orders', async (req, res) => {
  try {
    const { id } = req.params;
    const orderData = {
      customerId: id,
      ...req.body
    };

    const result = await CustomerService.createPurchaseOrder(orderData);

    if (result.success) {
      res.status(201).json(result);
    } else {
      res.status(result.error === 'Customer not found' ? 404 : 400).json(result);
    }
  } catch (error) {
    console.error('Error in POST /customers/:id/purchase-orders:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to create purchase order'
    });
  }
});

/**
 * @swagger
 * /api/customers/{id}/trends:
 *   get:
 *     summary: Get customer purchase trends and patterns
 *     tags: [Customers]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Customer ID
 *       - in: query
 *         name: dateFrom
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date filter
 *       - in: query
 *         name: dateTo
 *         schema:
 *           type: string
 *           format: date
 *         description: End date filter
 *       - in: query
 *         name: groupBy
 *         schema:
 *           type: string
 *           enum: [month, week, day, category, product]
 *           default: month
 *         description: Group purchase patterns by time period or dimension
 *     responses:
 *       200:
 *         description: Customer purchase trends retrieved successfully
 *       404:
 *         description: Customer not found
 *       500:
 *         description: Server error
 */
router.get('/:id/trends', async (req, res) => {
  try {
    const { id } = req.params;
    const { dateFrom, dateTo, groupBy = 'month' } = req.query;
    const params = { dateFrom, dateTo, groupBy };

    const result = await CustomerService.getCustomerPurchaseTrends(id, params);

    if (result.success) {
      res.json(result);
    } else {
      res.status(404).json(result);
    }
  } catch (error) {
    console.error('Error in GET /customers/:id/trends:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to retrieve customer purchase trends'
    });
  }
});

/**
 * @swagger
 * /api/customers/purchase-orders/search:
 *   get:
 *     summary: Search purchase orders across all customers
 *     tags: [Customers]
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Search term (order number, reference number, customer name/code)
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Number of items per page
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter by order status
 *     responses:
 *       200:
 *         description: Purchase orders search results retrieved successfully
 *       400:
 *         description: Bad request - search term required
 *       500:
 *         description: Server error
 */
router.get('/purchase-orders/search', async (req, res) => {
  try {
    const { q: searchTerm, page = 1, pageSize = 10, status, dateFrom, dateTo } = req.query;

    if (!searchTerm) {
      return res.status(400).json({
        success: false,
        error: 'Search term is required',
        message: 'Please provide a search term'
      });
    }

    const params = {
      page: parseInt(page),
      pageSize: parseInt(pageSize),
      status,
      dateFrom,
      dateTo
    };

    const result = await CustomerService.searchPurchaseOrders(searchTerm, params);

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Error in GET /customers/purchase-orders/search:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to search purchase orders'
    });
  }
});

/**
 * @swagger
 * /api/customers/high-value:
 *   get:
 *     summary: Get high value customers
 *     tags: [Customers]
 *     parameters:
 *       - in: query
 *         name: threshold
 *         schema:
 *           type: number
 *           default: 10000
 *         description: Minimum value threshold
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Maximum number of results
 *     responses:
 *       200:
 *         description: High value customers retrieved successfully
 *       500:
 *         description: Server error
 */
router.get('/high-value', async (req, res) => {
  try {
    const { threshold = 10000, limit = 50 } = req.query;
    const result = await CustomerService.getHighValueCustomers(
      parseFloat(threshold),
      parseInt(limit)
    );

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Error in GET /customers/high-value:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to retrieve high value customers'
    });
  }
});

export default router;