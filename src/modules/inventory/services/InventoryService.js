const StockLevel = require('../models/StockLevel');
const Product = require('../models/Product');
const { query, transaction } = require('../../config/database');
const { MOVEMENT_TYPES, REFERENCE_TYPES, ALERT_LEVELS } = require('../types');

class InventoryService {
  constructor(io = null) {
    this.io = io; // Socket.io instance for real-time updates
  }

  // Real-time stock update with notifications
  async updateStockWithNotification(productId, warehouseId, quantityChange, movementData) {
    try {
      const updatedStock = await StockLevel.updateStock(
        productId,
        warehouseId,
        quantityChange,
        movementData.movementType,
        movementData.referenceType,
        movementData.referenceId,
        movementData.options
      );

      // Get product details for notification
      const product = await Product.findById(productId);
      
      // Emit real-time update
      if (this.io) {
        this.io.emit('stock_updated', {
          productId,
          warehouseId,
          productName: product?.name,
          quantityChange,
          newQuantity: updatedStock.quantityOnHand,
          movementType: movementData.movementType,
          timestamp: new Date().toISOString()
        });
      }

      // Check for low stock alerts
      await this.checkAndNotifyLowStock(productId, warehouseId, updatedStock.quantityOnHand);

      return updatedStock;
    } catch (error) {
      throw new Error(`Failed to update stock: ${error.message}`);
    }
  }

  // Process stock receipt from purchase order
  async receiveStock(purchaseOrderId, receivedItems, receivedBy) {
    return await transaction(async (client) => {
      const results = [];

      // Get purchase order details
      const poResult = await client.query(
        `SELECT po.*, w.name as warehouse_name 
         FROM purchase_orders po
         JOIN warehouses w ON po.warehouse_id = w.id
         WHERE po.id = $1`,
        [purchaseOrderId]
      );

      if (poResult.rows.length === 0) {
        throw new Error('Purchase order not found');
      }

      const purchaseOrder = poResult.rows[0];

      for (const item of receivedItems) {
        const { productId, quantityReceived, batchNumber, expiryDate, actualUnitCost } = item;

        // Update stock level
        const updatedStock = await StockLevel.updateStock(
          productId,
          purchaseOrder.warehouse_id,
          quantityReceived,
          MOVEMENT_TYPES.IN,
          REFERENCE_TYPES.PURCHASE,
          purchaseOrderId,
          {
            batchNumber,
            expiryDate,
            unitCost: actualUnitCost,
            notes: `Received from PO ${purchaseOrder.po_number}`,
            createdBy: receivedBy
          }
        );

        // Update purchase order item
        await client.query(
          `UPDATE purchase_order_items 
           SET quantity_received = quantity_received + $1,
               updated_at = CURRENT_TIMESTAMP
           WHERE purchase_order_id = $2 AND product_id = $3`,
          [quantityReceived, purchaseOrderId, productId]
        );

        // Get product details for notification
        const product = await Product.findById(productId);

        results.push({
          productId,
          productName: product?.name,
          quantityReceived,
          newStockLevel: updatedStock.quantityOnHand
        });

        // Real-time notification
        if (this.io) {
          this.io.emit('stock_received', {
            productId,
            warehouseId: purchaseOrder.warehouse_id,
            productName: product?.name,
            quantityReceived,
            newQuantity: updatedStock.quantityOnHand,
            purchaseOrderNumber: purchaseOrder.po_number,
            timestamp: new Date().toISOString()
          });
        }
      }

      // Update purchase order status if fully received
      const fullyReceivedCheck = await client.query(
        `SELECT COUNT(*) as total_items,
                COUNT(CASE WHEN quantity_received >= quantity_ordered THEN 1 END) as received_items
         FROM purchase_order_items
         WHERE purchase_order_id = $1`,
        [purchaseOrderId]
      );

      const { total_items, received_items } = fullyReceivedCheck.rows[0];
      if (parseInt(total_items) === parseInt(received_items)) {
        await client.query(
          `UPDATE purchase_orders 
           SET status = 'RECEIVED', actual_delivery_date = CURRENT_DATE, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [purchaseOrderId]
        );
      }

      return results;
    });
  }

  // Process stock shipment (outbound)
  async shipStock(shipmentData, shippedBy) {
    const { warehouseId, items, referenceType, referenceId, notes } = shipmentData;

    return await transaction(async (client) => {
      const results = [];

      for (const item of items) {
        const { productId, quantity, batchNumber, serialNumber } = item;

        // Check available stock
        const stockLevel = await StockLevel.findByProductAndWarehouse(productId, warehouseId);
        if (!stockLevel || stockLevel.quantityAvailable < quantity) {
          throw new Error(`Insufficient stock for product ${productId}. Available: ${stockLevel?.quantityAvailable || 0}, Required: ${quantity}`);
        }

        // Update stock level
        const updatedStock = await StockLevel.updateStock(
          productId,
          warehouseId,
          -quantity,
          MOVEMENT_TYPES.OUT,
          referenceType,
          referenceId,
          {
            batchNumber,
            serialNumber,
            notes,
            createdBy: shippedBy
          }
        );

        // Get product details
        const product = await Product.findById(productId);

        results.push({
          productId,
          productName: product?.name,
          quantityShipped: quantity,
          newStockLevel: updatedStock.quantityOnHand
        });

        // Real-time notification
        if (this.io) {
          this.io.emit('stock_shipped', {
            productId,
            warehouseId,
            productName: product?.name,
            quantityShipped: quantity,
            newQuantity: updatedStock.quantityOnHand,
            timestamp: new Date().toISOString()
          });
        }

        // Check for low stock alerts
        await this.checkAndNotifyLowStock(productId, warehouseId, updatedStock.quantityOnHand);
      }

      return results;
    });
  }

  // Transfer stock between warehouses
  async transferStockBetweenWarehouses(transferData, createdBy) {
    const { fromWarehouseId, toWarehouseId, items, notes } = transferData;

    return await transaction(async (client) => {
      // Create transfer record
      const transferNumber = `TRF-${Date.now()}`;
      const transferResult = await client.query(
        `INSERT INTO stock_transfers (transfer_number, from_warehouse_id, to_warehouse_id, status, notes, created_by)
         VALUES ($1, $2, $3, 'PENDING', $4, $5)
         RETURNING *`,
        [transferNumber, fromWarehouseId, toWarehouseId, notes, createdBy]
      );

      const transfer = transferResult.rows[0];
      const results = [];

      for (const item of items) {
        const { productId, quantity, batchNumber, serialNumber } = item;

        // Check available stock in source warehouse
        const sourceStock = await StockLevel.findByProductAndWarehouse(productId, fromWarehouseId);
        if (!sourceStock || sourceStock.quantityAvailable < quantity) {
          throw new Error(`Insufficient stock for transfer. Product: ${productId}, Available: ${sourceStock?.quantityAvailable || 0}, Required: ${quantity}`);
        }

        // Create transfer item record
        await client.query(
          `INSERT INTO stock_transfer_items (stock_transfer_id, product_id, quantity, batch_number, serial_number)
           VALUES ($1, $2, $3, $4, $5)`,
          [transfer.id, productId, quantity, batchNumber, serialNumber]
        );

        // Transfer stock
        await StockLevel.transferStock(
          productId,
          fromWarehouseId,
          toWarehouseId,
          quantity,
          {
            transferId: transfer.id,
            batchNumber,
            serialNumber,
            notes: `Transfer ${transferNumber}`,
            createdBy
          }
        );

        // Get product details
        const product = await Product.findById(productId);

        results.push({
          productId,
          productName: product?.name,
          quantity,
          fromWarehouseId,
          toWarehouseId
        });

        // Real-time notification
        if (this.io) {
          this.io.emit('stock_transferred', {
            transferNumber,
            productId,
            productName: product?.name,
            quantity,
            fromWarehouseId,
            toWarehouseId,
            timestamp: new Date().toISOString()
          });
        }
      }

      // Update transfer status to completed
      await client.query(
        `UPDATE stock_transfers 
         SET status = 'COMPLETED', actual_arrival_date = CURRENT_DATE, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [transfer.id]
      );

      return {
        transferId: transfer.id,
        transferNumber,
        items: results
      };
    });
  }

  // Perform stock adjustment (cycle count, damage, etc.)
  async performStockAdjustment(adjustmentData, createdBy) {
    const { warehouseId, adjustmentType, reason, items } = adjustmentData;

    return await transaction(async (client) => {
      // Create adjustment record
      const adjustmentNumber = `ADJ-${Date.now()}`;
      const adjustmentResult = await client.query(
        `INSERT INTO stock_adjustments (adjustment_number, warehouse_id, adjustment_type, reason, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [adjustmentNumber, warehouseId, adjustmentType, reason, createdBy]
      );

      const adjustment = adjustmentResult.rows[0];
      const results = [];

      for (const item of items) {
        const { productId, systemQuantity, actualQuantity, unitCost, batchNumber, serialNumber, notes } = item;
        const variance = actualQuantity - systemQuantity;

        // Create adjustment item record
        await client.query(
          `INSERT INTO stock_adjustment_items 
           (stock_adjustment_id, product_id, system_quantity, actual_quantity, unit_cost, batch_number, serial_number, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [adjustment.id, productId, systemQuantity, actualQuantity, unitCost, batchNumber, serialNumber, notes]
        );

        // Update stock if there's a variance
        if (variance !== 0) {
          const updatedStock = await StockLevel.updateStock(
            productId,
            warehouseId,
            variance,
            MOVEMENT_TYPES.ADJUSTMENT,
            REFERENCE_TYPES.ADJUSTMENT,
            adjustment.id,
            {
              batchNumber,
              serialNumber,
              unitCost,
              notes: `${adjustmentType} - ${reason}`,
              createdBy
            }
          );

          // Get product details
          const product = await Product.findById(productId);

          results.push({
            productId,
            productName: product?.name,
            systemQuantity,
            actualQuantity,
            variance,
            newStockLevel: updatedStock.quantityOnHand
          });

          // Real-time notification
          if (this.io) {
            this.io.emit('stock_adjusted', {
              adjustmentNumber,
              productId,
              productName: product?.name,
              systemQuantity,
              actualQuantity,
              variance,
              newQuantity: updatedStock.quantityOnHand,
              timestamp: new Date().toISOString()
            });
          }

          // Check for low stock alerts
          await this.checkAndNotifyLowStock(productId, warehouseId, updatedStock.quantityOnHand);
        }
      }

      return {
        adjustmentId: adjustment.id,
        adjustmentNumber,
        items: results
      };
    });
  }

  // Check and notify low stock
  async checkAndNotifyLowStock(productId, warehouseId, currentQuantity) {
    try {
      // Get product reorder settings
      const product = await Product.findById(productId);
      if (!product) return;

      let alertLevel = null;
      if (currentQuantity === 0) {
        alertLevel = ALERT_LEVELS.OUT_OF_STOCK;
      } else if (currentQuantity <= product.minimumStockLevel) {
        alertLevel = ALERT_LEVELS.CRITICAL;
      } else if (currentQuantity <= product.reorderPoint) {
        alertLevel = ALERT_LEVELS.LOW;
      }

      if (alertLevel && this.io) {
        // Get warehouse details
        const warehouseResult = await query(
          'SELECT name FROM warehouses WHERE id = $1',
          [warehouseId]
        );
        const warehouseName = warehouseResult.rows[0]?.name;

        this.io.emit('low_stock_alert', {
          productId,
          warehouseId,
          productName: product.name,
          sku: product.sku,
          warehouseName,
          currentStock: currentQuantity,
          reorderPoint: product.reorderPoint,
          minimumStockLevel: product.minimumStockLevel,
          alertLevel,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error('Error checking low stock:', error);
    }
  }

  // Get real-time dashboard data
  async getDashboardData(warehouseId = null) {
    try {
      const dashboardData = {};

      // Total products
      dashboardData.totalProducts = await query(
        'SELECT COUNT(*) as count FROM products WHERE is_active = true'
      ).then(result => parseInt(result.rows[0].count));

      // Total stock value
      let stockValueQuery = `
        SELECT SUM(sl.quantity_on_hand * p.unit_cost) as total_value
        FROM stock_levels sl
        JOIN products p ON sl.product_id = p.id
        WHERE p.is_active = true
      `;
      let stockValueParams = [];

      if (warehouseId) {
        stockValueQuery += ' AND sl.warehouse_id = $1';
        stockValueParams = [warehouseId];
      }

      dashboardData.totalStockValue = await query(stockValueQuery, stockValueParams)
        .then(result => parseFloat(result.rows[0].total_value || 0));

      // Low stock items count
      let lowStockQuery = `
        SELECT COUNT(*) as count
        FROM stock_levels sl
        JOIN products p ON sl.product_id = p.id
        WHERE p.is_active = true AND sl.quantity_on_hand <= p.reorder_point
      `;
      let lowStockParams = [];

      if (warehouseId) {
        lowStockQuery += ' AND sl.warehouse_id = $1';
        lowStockParams = [warehouseId];
      }

      dashboardData.lowStockCount = await query(lowStockQuery, lowStockParams)
        .then(result => parseInt(result.rows[0].count));

      // Out of stock items count
      let outOfStockQuery = `
        SELECT COUNT(*) as count
        FROM stock_levels sl
        JOIN products p ON sl.product_id = p.id
        WHERE p.is_active = true AND sl.quantity_on_hand = 0
      `;
      let outOfStockParams = [];

      if (warehouseId) {
        outOfStockQuery += ' AND sl.warehouse_id = $1';
        outOfStockParams = [warehouseId];
      }

      dashboardData.outOfStockCount = await query(outOfStockQuery, outOfStockParams)
        .then(result => parseInt(result.rows[0].count));

      // Recent movements (last 24 hours)
      let recentMovementsQuery = `
        SELECT COUNT(*) as count
        FROM stock_movements sm
        WHERE sm.created_at >= NOW() - INTERVAL '24 hours'
      `;
      let recentMovementsParams = [];

      if (warehouseId) {
        recentMovementsQuery += ' AND sm.warehouse_id = $1';
        recentMovementsParams = [warehouseId];
      }

      dashboardData.recentMovements = await query(recentMovementsQuery, recentMovementsParams)
        .then(result => parseInt(result.rows[0].count));

      // Top moving products (last 30 days)
      let topProductsQuery = `
        SELECT p.id, p.name, p.sku, SUM(ABS(sm.quantity)) as total_movement
        FROM stock_movements sm
        JOIN products p ON sm.product_id = p.id
        WHERE sm.created_at >= NOW() - INTERVAL '30 days'
      `;
      let topProductsParams = [];

      if (warehouseId) {
        topProductsQuery += ' AND sm.warehouse_id = $1';
        topProductsParams = [warehouseId];
      }

      topProductsQuery += `
        GROUP BY p.id, p.name, p.sku
        ORDER BY total_movement DESC
        LIMIT 10
      `;

      dashboardData.topMovingProducts = await query(topProductsQuery, topProductsParams)
        .then(result => result.rows);

      return dashboardData;
    } catch (error) {
      throw new Error(`Failed to get dashboard data: ${error.message}`);
    }
  }

  // Generate stock reports
  async generateStockReport(reportType, options = {}) {
    const { warehouseId, startDate, endDate, productIds } = options;

    switch (reportType) {
      case 'stock_levels':
        return await this.generateStockLevelsReport(warehouseId, productIds);
      
      case 'movement_history':
        return await this.generateMovementHistoryReport(warehouseId, startDate, endDate, productIds);
      
      case 'low_stock':
        return await this.generateLowStockReport(warehouseId);
      
      case 'valuation':
        return await this.generateValuationReport(warehouseId);
      
      default:
        throw new Error('Invalid report type');
    }
  }

  async generateStockLevelsReport(warehouseId, productIds) {
    let whereClause = 'WHERE p.is_active = true';
    let params = [];
    let paramCount = 0;

    if (warehouseId) {
      paramCount++;
      whereClause += ` AND sl.warehouse_id = $${paramCount}`;
      params.push(warehouseId);
    }

    if (productIds && productIds.length > 0) {
      paramCount++;
      whereClause += ` AND p.id = ANY($${paramCount})`;
      params.push(productIds);
    }

    const result = await query(
      `SELECT 
         p.sku, p.name as product_name, p.unit_cost, p.selling_price,
         p.reorder_point, p.minimum_stock_level,
         w.name as warehouse_name, w.code as warehouse_code,
         sl.quantity_on_hand, sl.quantity_reserved, sl.quantity_available,
         (sl.quantity_on_hand * p.unit_cost) as stock_value,
         sl.last_movement_at,
         CASE 
           WHEN sl.quantity_on_hand = 0 THEN 'OUT_OF_STOCK'
           WHEN sl.quantity_on_hand <= p.minimum_stock_level THEN 'CRITICAL'
           WHEN sl.quantity_on_hand <= p.reorder_point THEN 'LOW'
           ELSE 'NORMAL'
         END as stock_status
       FROM products p
       LEFT JOIN stock_levels sl ON p.id = sl.product_id
       LEFT JOIN warehouses w ON sl.warehouse_id = w.id
       ${whereClause}
       ORDER BY p.name, w.name`,
      params
    );

    return result.rows;
  }

  async generateMovementHistoryReport(warehouseId, startDate, endDate, productIds) {
    let whereClause = 'WHERE 1=1';
    let params = [];
    let paramCount = 0;

    if (warehouseId) {
      paramCount++;
      whereClause += ` AND sm.warehouse_id = $${paramCount}`;
      params.push(warehouseId);
    }

    if (startDate) {
      paramCount++;
      whereClause += ` AND sm.created_at >= $${paramCount}`;
      params.push(startDate);
    }

    if (endDate) {
      paramCount++;
      whereClause += ` AND sm.created_at <= $${paramCount}`;
      params.push(endDate);
    }

    if (productIds && productIds.length > 0) {
      paramCount++;
      whereClause += ` AND sm.product_id = ANY($${paramCount})`;
      params.push(productIds);
    }

    const result = await query(
      `SELECT 
         p.sku, p.name as product_name,
         w.name as warehouse_name,
         sm.movement_type, sm.quantity, sm.reference_type, sm.reference_id,
         sm.batch_number, sm.serial_number, sm.unit_cost, sm.total_cost,
         sm.notes, sm.created_by, sm.created_at
       FROM stock_movements sm
       JOIN products p ON sm.product_id = p.id
       JOIN warehouses w ON sm.warehouse_id = w.id
       ${whereClause}
       ORDER BY sm.created_at DESC`,
      params
    );

    return result.rows;
  }

  async generateLowStockReport(warehouseId) {
    return await StockLevel.getLowStockItems(warehouseId);
  }

  async generateValuationReport(warehouseId) {
    return await StockLevel.getStockValuation(warehouseId);
  }
}

module.exports = InventoryService;