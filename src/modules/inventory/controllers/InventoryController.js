const InventoryService = require('../services/InventoryService');
const StockLevel = require('../models/StockLevel');
const Product = require('../models/Product');
const { query } = require('../../config/database');
const { body, validationResult } = require('express-validator');

class InventoryController {
  constructor(io = null) {
    this.inventoryService = new InventoryService(io);
  }

  // Get stock levels for a warehouse
  async getStockLevels(req, res) {
    try {
      const { warehouseId } = req.params;
      const { 
        limit = 50, 
        offset = 0, 
        search = '', 
        lowStockOnly = false 
      } = req.query;

      const options = {
        limit: parseInt(limit),
        offset: parseInt(offset),
        search,
        lowStockOnly: lowStockOnly === 'true'
      };

      const stockLevels = await StockLevel.findByWarehouse(warehouseId, options);
      
      // Get total count for pagination
      let countQuery = `
        SELECT COUNT(*) as count
        FROM stock_levels sl
        JOIN products p ON sl.product_id = p.id
        WHERE sl.warehouse_id = $1
      `;
      let countParams = [warehouseId];

      if (search) {
        countQuery += ` AND (p.name ILIKE $2 OR p.sku ILIKE $2)`;
        countParams.push(`%${search}%`);
      }

      if (lowStockOnly) {
        countQuery += ` AND sl.quantity_on_hand <= p.reorder_point`;
      }

      const countResult = await query(countQuery, countParams);
      const totalCount = parseInt(countResult.rows[0].count);

      res.json({
        success: true,
        data: stockLevels,
        pagination: {
          total: totalCount,
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: offset + limit < totalCount
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get stock levels',
        error: error.message
      });
    }
  }

  // Get stock level for specific product and warehouse
  async getProductStock(req, res) {
    try {
      const { productId, warehouseId } = req.params;

      const stockLevel = await StockLevel.findByProductAndWarehouse(productId, warehouseId);
      
      if (!stockLevel) {
        return res.status(404).json({
          success: false,
          message: 'Stock level not found'
        });
      }

      res.json({
        success: true,
        data: stockLevel
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get product stock',
        error: error.message
      });
    }
  }

  // Get stock summary for a product across all warehouses
  async getProductStockSummary(req, res) {
    try {
      const { productId } = req.params;

      const stockSummary = await Product.getStockSummary(productId);
      
      if (!stockSummary) {
        return res.status(404).json({
          success: false,
          message: 'Product not found'
        });
      }

      res.json({
        success: true,
        data: stockSummary
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get product stock summary',
        error: error.message
      });
    }
  }

  // Initialize stock for new product-warehouse combination
  async initializeStock(req, res) {
    try {
      const { productId, warehouseId } = req.params;
      const { initialQuantity = 0 } = req.body;

      const stockLevel = await StockLevel.initializeStock(productId, warehouseId, initialQuantity);

      res.status(201).json({
        success: true,
        message: 'Stock initialized successfully',
        data: stockLevel
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: 'Failed to initialize stock',
        error: error.message
      });
    }
  }

  // Receive stock (inbound)
  async receiveStock(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { purchaseOrderId, receivedItems, receivedBy } = req.body;

      const results = await this.inventoryService.receiveStock(
        purchaseOrderId,
        receivedItems,
        receivedBy
      );

      res.json({
        success: true,
        message: 'Stock received successfully',
        data: results
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: 'Failed to receive stock',
        error: error.message
      });
    }
  }

  // Ship stock (outbound)
  async shipStock(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { warehouseId, items, referenceType, referenceId, notes, shippedBy } = req.body;

      const results = await this.inventoryService.shipStock(
        { warehouseId, items, referenceType, referenceId, notes },
        shippedBy
      );

      res.json({
        success: true,
        message: 'Stock shipped successfully',
        data: results
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: 'Failed to ship stock',
        error: error.message
      });
    }
  }

  // Transfer stock between warehouses
  async transferStock(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { fromWarehouseId, toWarehouseId, items, notes, createdBy } = req.body;

      const result = await this.inventoryService.transferStockBetweenWarehouses(
        { fromWarehouseId, toWarehouseId, items, notes },
        createdBy
      );

      res.json({
        success: true,
        message: 'Stock transferred successfully',
        data: result
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: 'Failed to transfer stock',
        error: error.message
      });
    }
  }

  // Perform stock adjustment
  async adjustStock(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { warehouseId, adjustmentType, reason, items, createdBy } = req.body;

      const result = await this.inventoryService.performStockAdjustment(
        { warehouseId, adjustmentType, reason, items },
        createdBy
      );

      res.json({
        success: true,
        message: 'Stock adjusted successfully',
        data: result
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: 'Failed to adjust stock',
        error: error.message
      });
    }
  }

  // Reserve stock
  async reserveStock(req, res) {
    try {
      const { productId, warehouseId } = req.params;
      const { quantity } = req.body;

      const updatedStock = await StockLevel.reserveStock(productId, warehouseId, quantity);

      res.json({
        success: true,
        message: 'Stock reserved successfully',
        data: updatedStock
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: 'Failed to reserve stock',
        error: error.message
      });
    }
  }

  // Release reserved stock
  async releaseReservedStock(req, res) {
    try {
      const { productId, warehouseId } = req.params;
      const { quantity } = req.body;

      const updatedStock = await StockLevel.releaseReservedStock(productId, warehouseId, quantity);

      res.json({
        success: true,
        message: 'Reserved stock released successfully',
        data: updatedStock
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: 'Failed to release reserved stock',
        error: error.message
      });
    }
  }

  // Get stock movement history
  async getMovementHistory(req, res) {
    try {
      const { productId, warehouseId } = req.params;
      const { 
        limit = 50, 
        offset = 0, 
        startDate, 
        endDate 
      } = req.query;

      const options = {
        limit: parseInt(limit),
        offset: parseInt(offset),
        startDate,
        endDate
      };

      const movements = await StockLevel.getMovementHistory(productId, warehouseId, options);

      res.json({
        success: true,
        data: movements
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get movement history',
        error: error.message
      });
    }
  }

  // Get low stock items
  async getLowStockItems(req, res) {
    try {
      const { warehouseId } = req.query;

      const lowStockItems = await StockLevel.getLowStockItems(warehouseId);

      res.json({
        success: true,
        data: lowStockItems
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get low stock items',
        error: error.message
      });
    }
  }

  // Get products needing reorder
  async getProductsNeedingReorder(req, res) {
    try {
      const { warehouseId } = req.query;

      const products = await Product.getProductsNeedingReorder(warehouseId);

      res.json({
        success: true,
        data: products
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get products needing reorder',
        error: error.message
      });
    }
  }

  // Get stock valuation
  async getStockValuation(req, res) {
    try {
      const { warehouseId } = req.query;

      const valuation = await StockLevel.getStockValuation(warehouseId);

      res.json({
        success: true,
        data: valuation
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get stock valuation',
        error: error.message
      });
    }
  }

  // Get dashboard data
  async getDashboardData(req, res) {
    try {
      const { warehouseId } = req.query;

      const dashboardData = await this.inventoryService.getDashboardData(warehouseId);

      res.json({
        success: true,
        data: dashboardData
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get dashboard data',
        error: error.message
      });
    }
  }

  // Generate reports
  async generateReport(req, res) {
    try {
      const { reportType } = req.params;
      const { warehouseId, startDate, endDate, productIds } = req.query;

      const options = {
        warehouseId,
        startDate,
        endDate,
        productIds: productIds ? productIds.split(',') : null
      };

      const reportData = await this.inventoryService.generateStockReport(reportType, options);

      res.json({
        success: true,
        data: reportData,
        reportType,
        generatedAt: new Date().toISOString()
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: 'Failed to generate report',
        error: error.message
      });
    }
  }

  // Get low stock alerts
  async getLowStockAlerts(req, res) {
    try {
      const { warehouseId, acknowledged } = req.query;
      
      let whereClause = 'WHERE 1=1';
      let params = [];
      let paramCount = 0;

      if (warehouseId) {
        paramCount++;
        whereClause += ` AND lsa.warehouse_id = $${paramCount}`;
        params.push(warehouseId);
      }

      if (acknowledged !== undefined) {
        paramCount++;
        whereClause += ` AND lsa.is_acknowledged = $${paramCount}`;
        params.push(acknowledged === 'true');
      }

      const result = await query(
        `SELECT 
           lsa.*, 
           p.name as product_name, 
           p.sku,
           w.name as warehouse_name,
           w.code as warehouse_code
         FROM low_stock_alerts lsa
         JOIN products p ON lsa.product_id = p.id
         JOIN warehouses w ON lsa.warehouse_id = w.id
         ${whereClause}
         ORDER BY lsa.created_at DESC`,
        params
      );

      res.json({
        success: true,
        data: result.rows
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get low stock alerts',
        error: error.message
      });
    }
  }

  // Acknowledge low stock alert
  async acknowledgeLowStockAlert(req, res) {
    try {
      const { alertId } = req.params;
      const { acknowledgedBy } = req.body;

      const result = await query(
        `UPDATE low_stock_alerts 
         SET is_acknowledged = true, acknowledged_by = $1, acknowledged_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING *`,
        [acknowledgedBy, alertId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Alert not found'
        });
      }

      res.json({
        success: true,
        message: 'Alert acknowledged successfully',
        data: result.rows[0]
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to acknowledge alert',
        error: error.message
      });
    }
  }
}

// Validation middleware
const receiveStockValidation = [
  body('purchaseOrderId').isUUID().withMessage('Valid purchase order ID is required'),
  body('receivedItems').isArray().withMessage('Received items must be an array'),
  body('receivedItems.*.productId').isUUID().withMessage('Valid product ID is required'),
  body('receivedItems.*.quantityReceived').isInt({ min: 1 }).withMessage('Quantity received must be a positive integer'),
  body('receivedBy').notEmpty().withMessage('Received by is required')
];

const shipStockValidation = [
  body('warehouseId').isUUID().withMessage('Valid warehouse ID is required'),
  body('items').isArray().withMessage('Items must be an array'),
  body('items.*.productId').isUUID().withMessage('Valid product ID is required'),
  body('items.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be a positive integer'),
  body('referenceType').notEmpty().withMessage('Reference type is required'),
  body('shippedBy').notEmpty().withMessage('Shipped by is required')
];

const transferStockValidation = [
  body('fromWarehouseId').isUUID().withMessage('Valid from warehouse ID is required'),
  body('toWarehouseId').isUUID().withMessage('Valid to warehouse ID is required'),
  body('items').isArray().withMessage('Items must be an array'),
  body('items.*.productId').isUUID().withMessage('Valid product ID is required'),
  body('items.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be a positive integer'),
  body('createdBy').notEmpty().withMessage('Created by is required')
];

const adjustStockValidation = [
  body('warehouseId').isUUID().withMessage('Valid warehouse ID is required'),
  body('adjustmentType').isIn(['PHYSICAL_COUNT', 'DAMAGE', 'THEFT', 'CORRECTION', 'EXPIRY']).withMessage('Valid adjustment type is required'),
  body('items').isArray().withMessage('Items must be an array'),
  body('items.*.productId').isUUID().withMessage('Valid product ID is required'),
  body('items.*.systemQuantity').isInt({ min: 0 }).withMessage('System quantity must be a non-negative integer'),
  body('items.*.actualQuantity').isInt({ min: 0 }).withMessage('Actual quantity must be a non-negative integer'),
  body('createdBy').notEmpty().withMessage('Created by is required')
];

module.exports = {
  InventoryController,
  receiveStockValidation,
  shipStockValidation,
  transferStockValidation,
  adjustStockValidation
};