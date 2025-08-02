const { query, transaction } = require('../../config/database');
const { MOVEMENT_TYPES, ALERT_LEVELS } = require('../types');

class StockLevel {
  constructor(data) {
    this.id = data.id;
    this.productId = data.product_id;
    this.warehouseId = data.warehouse_id;
    this.quantityOnHand = data.quantity_on_hand;
    this.quantityReserved = data.quantity_reserved;
    this.quantityAvailable = data.quantity_available;
    this.lastCountedAt = data.last_counted_at;
    this.lastMovementAt = data.last_movement_at;
    this.createdAt = data.created_at;
    this.updatedAt = data.updated_at;
  }

  // Get stock level by product and warehouse
  static async findByProductAndWarehouse(productId, warehouseId) {
    const result = await query(
      `SELECT sl.*, p.name as product_name, p.sku, w.name as warehouse_name, w.code as warehouse_code
       FROM stock_levels sl
       JOIN products p ON sl.product_id = p.id
       JOIN warehouses w ON sl.warehouse_id = w.id
       WHERE sl.product_id = $1 AND sl.warehouse_id = $2`,
      [productId, warehouseId]
    );
    return result.rows[0] ? new StockLevel(result.rows[0]) : null;
  }

  // Get all stock levels for a product across warehouses
  static async findByProduct(productId) {
    const result = await query(
      `SELECT sl.*, p.name as product_name, p.sku, w.name as warehouse_name, w.code as warehouse_code
       FROM stock_levels sl
       JOIN products p ON sl.product_id = p.id
       JOIN warehouses w ON sl.warehouse_id = w.id
       WHERE sl.product_id = $1
       ORDER BY w.name`,
      [productId]
    );
    return result.rows.map(row => new StockLevel(row));
  }

  // Get all stock levels for a warehouse
  static async findByWarehouse(warehouseId, options = {}) {
    const { limit = 100, offset = 0, search = '', lowStockOnly = false } = options;
    
    let whereClause = 'WHERE sl.warehouse_id = $1';
    let params = [warehouseId];
    let paramCount = 1;

    if (search) {
      paramCount++;
      whereClause += ` AND (p.name ILIKE $${paramCount} OR p.sku ILIKE $${paramCount})`;
      params.push(`%${search}%`);
    }

    if (lowStockOnly) {
      whereClause += ` AND sl.quantity_on_hand <= p.reorder_point`;
    }

    const result = await query(
      `SELECT sl.*, p.name as product_name, p.sku, p.reorder_point, p.minimum_stock_level,
              w.name as warehouse_name, w.code as warehouse_code
       FROM stock_levels sl
       JOIN products p ON sl.product_id = p.id
       JOIN warehouses w ON sl.warehouse_id = w.id
       ${whereClause}
       ORDER BY p.name
       LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`,
      [...params, limit, offset]
    );
    return result.rows.map(row => new StockLevel(row));
  }

  // Initialize stock level for new product-warehouse combination
  static async initializeStock(productId, warehouseId, initialQuantity = 0) {
    return await transaction(async (client) => {
      // Check if stock level already exists
      const existing = await client.query(
        'SELECT id FROM stock_levels WHERE product_id = $1 AND warehouse_id = $2',
        [productId, warehouseId]
      );

      if (existing.rows.length > 0) {
        throw new Error('Stock level already exists for this product-warehouse combination');
      }

      // Create stock level
      const result = await client.query(
        `INSERT INTO stock_levels (product_id, warehouse_id, quantity_on_hand)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [productId, warehouseId, initialQuantity]
      );

      // Record initial stock movement if quantity > 0
      if (initialQuantity > 0) {
        await client.query(
          `INSERT INTO stock_movements 
           (product_id, warehouse_id, movement_type, quantity, reference_type, notes)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [productId, warehouseId, MOVEMENT_TYPES.IN, initialQuantity, 'INITIALIZATION', 'Initial stock setup']
        );
      }

      return new StockLevel(result.rows[0]);
    });
  }

  // Update stock quantity
  static async updateStock(productId, warehouseId, quantityChange, movementType, referenceType, referenceId = null, options = {}) {
    const { batchNumber, serialNumber, expiryDate, unitCost, notes, createdBy } = options;

    return await transaction(async (client) => {
      // Get current stock level
      const currentStock = await client.query(
        'SELECT * FROM stock_levels WHERE product_id = $1 AND warehouse_id = $2',
        [productId, warehouseId]
      );

      if (currentStock.rows.length === 0) {
        throw new Error('Stock level not found for this product-warehouse combination');
      }

      const current = currentStock.rows[0];
      const newQuantity = current.quantity_on_hand + quantityChange;

      if (newQuantity < 0) {
        throw new Error('Insufficient stock. Cannot reduce stock below zero.');
      }

      // Update stock level
      const updatedStock = await client.query(
        `UPDATE stock_levels 
         SET quantity_on_hand = $1, last_movement_at = CURRENT_TIMESTAMP
         WHERE product_id = $2 AND warehouse_id = $3
         RETURNING *`,
        [newQuantity, productId, warehouseId]
      );

      // Record stock movement
      await client.query(
        `INSERT INTO stock_movements 
         (product_id, warehouse_id, movement_type, quantity, reference_type, reference_id,
          batch_number, serial_number, expiry_date, unit_cost, total_cost, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          productId, warehouseId, movementType, quantityChange, referenceType, referenceId,
          batchNumber, serialNumber, expiryDate, unitCost, 
          unitCost ? unitCost * Math.abs(quantityChange) : null,
          notes, createdBy
        ]
      );

      // Check for low stock alerts
      await this.checkLowStockAlert(client, productId, warehouseId, newQuantity);

      return new StockLevel(updatedStock.rows[0]);
    });
  }

  // Reserve stock for orders
  static async reserveStock(productId, warehouseId, quantity) {
    return await transaction(async (client) => {
      const result = await client.query(
        `UPDATE stock_levels 
         SET quantity_reserved = quantity_reserved + $1
         WHERE product_id = $2 AND warehouse_id = $3 
         AND quantity_available >= $1
         RETURNING *`,
        [quantity, productId, warehouseId]
      );

      if (result.rows.length === 0) {
        throw new Error('Insufficient available stock to reserve');
      }

      return new StockLevel(result.rows[0]);
    });
  }

  // Release reserved stock
  static async releaseReservedStock(productId, warehouseId, quantity) {
    const result = await query(
      `UPDATE stock_levels 
       SET quantity_reserved = GREATEST(0, quantity_reserved - $1)
       WHERE product_id = $2 AND warehouse_id = $3
       RETURNING *`,
      [quantity, productId, warehouseId]
    );

    if (result.rows.length === 0) {
      throw new Error('Stock level not found');
    }

    return new StockLevel(result.rows[0]);
  }

  // Transfer stock between warehouses
  static async transferStock(productId, fromWarehouseId, toWarehouseId, quantity, options = {}) {
    const { transferId, batchNumber, serialNumber, notes, createdBy } = options;

    return await transaction(async (client) => {
      // Reduce stock from source warehouse
      await client.query(
        `UPDATE stock_levels 
         SET quantity_on_hand = quantity_on_hand - $1, last_movement_at = CURRENT_TIMESTAMP
         WHERE product_id = $2 AND warehouse_id = $3 AND quantity_on_hand >= $1`,
        [quantity, productId, fromWarehouseId]
      );

      // Increase stock in destination warehouse (create if doesn't exist)
      await client.query(
        `INSERT INTO stock_levels (product_id, warehouse_id, quantity_on_hand, last_movement_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
         ON CONFLICT (product_id, warehouse_id)
         DO UPDATE SET 
           quantity_on_hand = stock_levels.quantity_on_hand + $3,
           last_movement_at = CURRENT_TIMESTAMP`,
        [productId, toWarehouseId, quantity]
      );

      // Record outbound movement
      await client.query(
        `INSERT INTO stock_movements 
         (product_id, warehouse_id, movement_type, quantity, reference_type, reference_id,
          batch_number, serial_number, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          productId, fromWarehouseId, MOVEMENT_TYPES.OUT, -quantity, 'TRANSFER', transferId,
          batchNumber, serialNumber, notes, createdBy
        ]
      );

      // Record inbound movement
      await client.query(
        `INSERT INTO stock_movements 
         (product_id, warehouse_id, movement_type, quantity, reference_type, reference_id,
          batch_number, serial_number, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          productId, toWarehouseId, MOVEMENT_TYPES.IN, quantity, 'TRANSFER', transferId,
          batchNumber, serialNumber, notes, createdBy
        ]
      );

      // Check low stock alerts for both warehouses
      const fromStock = await client.query(
        'SELECT quantity_on_hand FROM stock_levels WHERE product_id = $1 AND warehouse_id = $2',
        [productId, fromWarehouseId]
      );
      
      if (fromStock.rows.length > 0) {
        await this.checkLowStockAlert(client, productId, fromWarehouseId, fromStock.rows[0].quantity_on_hand);
      }

      return true;
    });
  }

  // Check and create low stock alerts
  static async checkLowStockAlert(client, productId, warehouseId, currentQuantity) {
    // Get product reorder point
    const product = await client.query(
      'SELECT reorder_point, minimum_stock_level FROM products WHERE id = $1',
      [productId]
    );

    if (product.rows.length === 0) return;

    const { reorder_point, minimum_stock_level } = product.rows[0];
    let alertLevel = null;

    if (currentQuantity === 0) {
      alertLevel = ALERT_LEVELS.OUT_OF_STOCK;
    } else if (currentQuantity <= minimum_stock_level) {
      alertLevel = ALERT_LEVELS.CRITICAL;
    } else if (currentQuantity <= reorder_point) {
      alertLevel = ALERT_LEVELS.LOW;
    }

    if (alertLevel) {
      // Check if alert already exists and is not acknowledged
      const existingAlert = await client.query(
        'SELECT id FROM low_stock_alerts WHERE product_id = $1 AND warehouse_id = $2 AND is_acknowledged = false',
        [productId, warehouseId]
      );

      if (existingAlert.rows.length === 0) {
        // Create new alert
        await client.query(
          `INSERT INTO low_stock_alerts 
           (product_id, warehouse_id, current_stock, reorder_point, alert_level)
           VALUES ($1, $2, $3, $4, $5)`,
          [productId, warehouseId, currentQuantity, reorder_point, alertLevel]
        );
      } else {
        // Update existing alert
        await client.query(
          `UPDATE low_stock_alerts 
           SET current_stock = $1, alert_level = $2, created_at = CURRENT_TIMESTAMP
           WHERE product_id = $3 AND warehouse_id = $4 AND is_acknowledged = false`,
          [currentQuantity, alertLevel, productId, warehouseId]
        );
      }
    }
  }

  // Get stock movement history
  static async getMovementHistory(productId, warehouseId, options = {}) {
    const { limit = 50, offset = 0, startDate, endDate } = options;
    
    let whereClause = 'WHERE sm.product_id = $1 AND sm.warehouse_id = $2';
    let params = [productId, warehouseId];
    let paramCount = 2;

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

    const result = await query(
      `SELECT sm.*, p.name as product_name, p.sku, w.name as warehouse_name
       FROM stock_movements sm
       JOIN products p ON sm.product_id = p.id
       JOIN warehouses w ON sm.warehouse_id = w.id
       ${whereClause}
       ORDER BY sm.created_at DESC
       LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`,
      [...params, limit, offset]
    );

    return result.rows;
  }

  // Get low stock items across all warehouses
  static async getLowStockItems(warehouseId = null) {
    let whereClause = '';
    let params = [];

    if (warehouseId) {
      whereClause = 'WHERE sl.warehouse_id = $1';
      params = [warehouseId];
    }

    const result = await query(
      `SELECT sl.*, p.name as product_name, p.sku, p.reorder_point, p.minimum_stock_level,
              w.name as warehouse_name, w.code as warehouse_code,
              CASE 
                WHEN sl.quantity_on_hand = 0 THEN 'OUT_OF_STOCK'
                WHEN sl.quantity_on_hand <= p.minimum_stock_level THEN 'CRITICAL'
                WHEN sl.quantity_on_hand <= p.reorder_point THEN 'LOW'
                ELSE 'NORMAL'
              END as stock_status
       FROM stock_levels sl
       JOIN products p ON sl.product_id = p.id
       JOIN warehouses w ON sl.warehouse_id = w.id
       ${whereClause}
       AND sl.quantity_on_hand <= p.reorder_point
       ORDER BY 
         CASE 
           WHEN sl.quantity_on_hand = 0 THEN 1
           WHEN sl.quantity_on_hand <= p.minimum_stock_level THEN 2
           ELSE 3
         END,
         p.name`,
      params
    );

    return result.rows;
  }

  // Get stock valuation
  static async getStockValuation(warehouseId = null) {
    let whereClause = '';
    let params = [];

    if (warehouseId) {
      whereClause = 'WHERE sl.warehouse_id = $1';
      params = [warehouseId];
    }

    const result = await query(
      `SELECT 
         sl.warehouse_id,
         w.name as warehouse_name,
         SUM(sl.quantity_on_hand * p.unit_cost) as total_value,
         SUM(sl.quantity_on_hand) as total_quantity,
         COUNT(DISTINCT sl.product_id) as unique_products
       FROM stock_levels sl
       JOIN products p ON sl.product_id = p.id
       JOIN warehouses w ON sl.warehouse_id = w.id
       ${whereClause}
       GROUP BY sl.warehouse_id, w.name
       ORDER BY w.name`,
      params
    );

    return result.rows;
  }
}

module.exports = StockLevel;