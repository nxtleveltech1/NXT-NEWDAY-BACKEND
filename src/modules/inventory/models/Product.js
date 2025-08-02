const { query, transaction } = require('../../config/database');

class Product {
  constructor(data) {
    this.id = data.id;
    this.sku = data.sku;
    this.name = data.name;
    this.description = data.description;
    this.categoryId = data.category_id;
    this.supplierId = data.supplier_id;
    this.unitOfMeasure = data.unit_of_measure;
    this.unitCost = data.unit_cost;
    this.sellingPrice = data.selling_price;
    this.weight = data.weight;
    this.dimensions = data.dimensions;
    this.barcode = data.barcode;
    this.minimumStockLevel = data.minimum_stock_level;
    this.maximumStockLevel = data.maximum_stock_level;
    this.reorderPoint = data.reorder_point;
    this.reorderQuantity = data.reorder_quantity;
    this.leadTimeDays = data.lead_time_days;
    this.isSerialized = data.is_serialized;
    this.isBatchTracked = data.is_batch_tracked;
    this.isPerishable = data.is_perishable;
    this.shelfLifeDays = data.shelf_life_days;
    this.storageConditions = data.storage_conditions;
    this.isActive = data.is_active;
    this.createdAt = data.created_at;
    this.updatedAt = data.updated_at;
  }

  // Create new product
  static async create(productData) {
    const {
      sku, name, description, categoryId, supplierId, unitOfMeasure,
      unitCost, sellingPrice, weight, dimensions, barcode,
      minimumStockLevel, maximumStockLevel, reorderPoint, reorderQuantity,
      leadTimeDays, isSerialized, isBatchTracked, isPerishable,
      shelfLifeDays, storageConditions
    } = productData;

    const result = await query(
      `INSERT INTO products (
        sku, name, description, category_id, supplier_id, unit_of_measure,
        unit_cost, selling_price, weight, dimensions, barcode,
        minimum_stock_level, maximum_stock_level, reorder_point, reorder_quantity,
        lead_time_days, is_serialized, is_batch_tracked, is_perishable,
        shelf_life_days, storage_conditions
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
      RETURNING *`,
      [
        sku, name, description, categoryId, supplierId, unitOfMeasure,
        unitCost, sellingPrice, weight, JSON.stringify(dimensions), barcode,
        minimumStockLevel, maximumStockLevel, reorderPoint, reorderQuantity,
        leadTimeDays, isSerialized, isBatchTracked, isPerishable,
        shelfLifeDays, storageConditions
      ]
    );

    return new Product(result.rows[0]);
  }

  // Find product by ID
  static async findById(id) {
    const result = await query(
      `SELECT p.*, c.name as category_name, s.name as supplier_name
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       LEFT JOIN suppliers s ON p.supplier_id = s.id
       WHERE p.id = $1`,
      [id]
    );
    return result.rows[0] ? new Product(result.rows[0]) : null;
  }

  // Find product by SKU
  static async findBySku(sku) {
    const result = await query(
      `SELECT p.*, c.name as category_name, s.name as supplier_name
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       LEFT JOIN suppliers s ON p.supplier_id = s.id
       WHERE p.sku = $1`,
      [sku]
    );
    return result.rows[0] ? new Product(result.rows[0]) : null;
  }

  // Find products with pagination and filtering
  static async findAll(options = {}) {
    const {
      limit = 50,
      offset = 0,
      search = '',
      categoryId = null,
      supplierId = null,
      isActive = true,
      sortBy = 'name',
      sortOrder = 'ASC'
    } = options;

    let whereClause = 'WHERE 1=1';
    let params = [];
    let paramCount = 0;

    if (isActive !== null) {
      paramCount++;
      whereClause += ` AND p.is_active = $${paramCount}`;
      params.push(isActive);
    }

    if (search) {
      paramCount++;
      whereClause += ` AND (p.name ILIKE $${paramCount} OR p.sku ILIKE $${paramCount} OR p.description ILIKE $${paramCount})`;
      params.push(`%${search}%`);
    }

    if (categoryId) {
      paramCount++;
      whereClause += ` AND p.category_id = $${paramCount}`;
      params.push(categoryId);
    }

    if (supplierId) {
      paramCount++;
      whereClause += ` AND p.supplier_id = $${paramCount}`;
      params.push(supplierId);
    }

    const validSortColumns = ['name', 'sku', 'unit_cost', 'selling_price', 'created_at'];
    const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'name';
    const order = sortOrder.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

    const result = await query(
      `SELECT p.*, c.name as category_name, s.name as supplier_name
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       LEFT JOIN suppliers s ON p.supplier_id = s.id
       ${whereClause}
       ORDER BY p.${sortColumn} ${order}
       LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`,
      [...params, limit, offset]
    );

    return result.rows.map(row => new Product(row));
  }

  // Get product count for pagination
  static async getCount(options = {}) {
    const {
      search = '',
      categoryId = null,
      supplierId = null,
      isActive = true
    } = options;

    let whereClause = 'WHERE 1=1';
    let params = [];
    let paramCount = 0;

    if (isActive !== null) {
      paramCount++;
      whereClause += ` AND is_active = $${paramCount}`;
      params.push(isActive);
    }

    if (search) {
      paramCount++;
      whereClause += ` AND (name ILIKE $${paramCount} OR sku ILIKE $${paramCount} OR description ILIKE $${paramCount})`;
      params.push(`%${search}%`);
    }

    if (categoryId) {
      paramCount++;
      whereClause += ` AND category_id = $${paramCount}`;
      params.push(categoryId);
    }

    if (supplierId) {
      paramCount++;
      whereClause += ` AND supplier_id = $${paramCount}`;
      params.push(supplierId);
    }

    const result = await query(
      `SELECT COUNT(*) as count FROM products ${whereClause}`,
      params
    );

    return parseInt(result.rows[0].count);
  }

  // Update product
  static async update(id, updateData) {
    const {
      name, description, categoryId, supplierId, unitOfMeasure,
      unitCost, sellingPrice, weight, dimensions, barcode,
      minimumStockLevel, maximumStockLevel, reorderPoint, reorderQuantity,
      leadTimeDays, isSerialized, isBatchTracked, isPerishable,
      shelfLifeDays, storageConditions, isActive
    } = updateData;

    const result = await query(
      `UPDATE products SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        category_id = COALESCE($3, category_id),
        supplier_id = COALESCE($4, supplier_id),
        unit_of_measure = COALESCE($5, unit_of_measure),
        unit_cost = COALESCE($6, unit_cost),
        selling_price = COALESCE($7, selling_price),
        weight = COALESCE($8, weight),
        dimensions = COALESCE($9, dimensions),
        barcode = COALESCE($10, barcode),
        minimum_stock_level = COALESCE($11, minimum_stock_level),
        maximum_stock_level = COALESCE($12, maximum_stock_level),
        reorder_point = COALESCE($13, reorder_point),
        reorder_quantity = COALESCE($14, reorder_quantity),
        lead_time_days = COALESCE($15, lead_time_days),
        is_serialized = COALESCE($16, is_serialized),
        is_batch_tracked = COALESCE($17, is_batch_tracked),
        is_perishable = COALESCE($18, is_perishable),
        shelf_life_days = COALESCE($19, shelf_life_days),
        storage_conditions = COALESCE($20, storage_conditions),
        is_active = COALESCE($21, is_active),
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $22
       RETURNING *`,
      [
        name, description, categoryId, supplierId, unitOfMeasure,
        unitCost, sellingPrice, weight, dimensions ? JSON.stringify(dimensions) : null, barcode,
        minimumStockLevel, maximumStockLevel, reorderPoint, reorderQuantity,
        leadTimeDays, isSerialized, isBatchTracked, isPerishable,
        shelfLifeDays, storageConditions, isActive, id
      ]
    );

    return result.rows[0] ? new Product(result.rows[0]) : null;
  }

  // Delete product (soft delete)
  static async delete(id) {
    const result = await query(
      'UPDATE products SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *',
      [id]
    );
    return result.rows[0] ? new Product(result.rows[0]) : null;
  }

  // Get products that need reordering
  static async getProductsNeedingReorder(warehouseId = null) {
    let whereClause = '';
    let params = [];

    if (warehouseId) {
      whereClause = 'AND sl.warehouse_id = $1';
      params = [warehouseId];
    }

    const result = await query(
      `SELECT p.*, sl.quantity_on_hand, sl.warehouse_id, w.name as warehouse_name,
              c.name as category_name, s.name as supplier_name
       FROM products p
       JOIN stock_levels sl ON p.id = sl.product_id
       JOIN warehouses w ON sl.warehouse_id = w.id
       LEFT JOIN categories c ON p.category_id = c.id
       LEFT JOIN suppliers s ON p.supplier_id = s.id
       WHERE p.is_active = true 
       AND sl.quantity_on_hand <= p.reorder_point
       ${whereClause}
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

  // Get product stock summary across all warehouses
  static async getStockSummary(productId) {
    const result = await query(
      `SELECT 
         p.id, p.sku, p.name, p.unit_cost, p.selling_price,
         p.minimum_stock_level, p.maximum_stock_level, p.reorder_point,
         w.id as warehouse_id, w.name as warehouse_name, w.code as warehouse_code,
         sl.quantity_on_hand, sl.quantity_reserved, sl.quantity_available,
         sl.last_movement_at
       FROM products p
       LEFT JOIN stock_levels sl ON p.id = sl.product_id
       LEFT JOIN warehouses w ON sl.warehouse_id = w.id
       WHERE p.id = $1 AND w.is_active = true
       ORDER BY w.name`,
      [productId]
    );

    const product = result.rows[0];
    if (!product) return null;

    return {
      product: {
        id: product.id,
        sku: product.sku,
        name: product.name,
        unitCost: product.unit_cost,
        sellingPrice: product.selling_price,
        minimumStockLevel: product.minimum_stock_level,
        maximumStockLevel: product.maximum_stock_level,
        reorderPoint: product.reorder_point
      },
      warehouses: result.rows.map(row => ({
        warehouseId: row.warehouse_id,
        warehouseName: row.warehouse_name,
        warehouseCode: row.warehouse_code,
        quantityOnHand: row.quantity_on_hand || 0,
        quantityReserved: row.quantity_reserved || 0,
        quantityAvailable: row.quantity_available || 0,
        lastMovementAt: row.last_movement_at
      })),
      totalStock: result.rows.reduce((sum, row) => sum + (row.quantity_on_hand || 0), 0),
      totalReserved: result.rows.reduce((sum, row) => sum + (row.quantity_reserved || 0), 0),
      totalAvailable: result.rows.reduce((sum, row) => sum + (row.quantity_available || 0), 0)
    };
  }

  // Bulk import products
  static async bulkImport(products) {
    return await transaction(async (client) => {
      const results = [];
      
      for (const productData of products) {
        try {
          const result = await client.query(
            `INSERT INTO products (
              sku, name, description, category_id, supplier_id, unit_of_measure,
              unit_cost, selling_price, weight, dimensions, barcode,
              minimum_stock_level, maximum_stock_level, reorder_point, reorder_quantity,
              lead_time_days, is_serialized, is_batch_tracked, is_perishable,
              shelf_life_days, storage_conditions
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
            ON CONFLICT (sku) DO UPDATE SET
              name = EXCLUDED.name,
              description = EXCLUDED.description,
              category_id = EXCLUDED.category_id,
              supplier_id = EXCLUDED.supplier_id,
              unit_of_measure = EXCLUDED.unit_of_measure,
              unit_cost = EXCLUDED.unit_cost,
              selling_price = EXCLUDED.selling_price,
              weight = EXCLUDED.weight,
              dimensions = EXCLUDED.dimensions,
              barcode = EXCLUDED.barcode,
              minimum_stock_level = EXCLUDED.minimum_stock_level,
              maximum_stock_level = EXCLUDED.maximum_stock_level,
              reorder_point = EXCLUDED.reorder_point,
              reorder_quantity = EXCLUDED.reorder_quantity,
              lead_time_days = EXCLUDED.lead_time_days,
              is_serialized = EXCLUDED.is_serialized,
              is_batch_tracked = EXCLUDED.is_batch_tracked,
              is_perishable = EXCLUDED.is_perishable,
              shelf_life_days = EXCLUDED.shelf_life_days,
              storage_conditions = EXCLUDED.storage_conditions,
              updated_at = CURRENT_TIMESTAMP
            RETURNING *`,
            [
              productData.sku, productData.name, productData.description,
              productData.categoryId, productData.supplierId, productData.unitOfMeasure,
              productData.unitCost, productData.sellingPrice, productData.weight,
              productData.dimensions ? JSON.stringify(productData.dimensions) : null,
              productData.barcode, productData.minimumStockLevel, productData.maximumStockLevel,
              productData.reorderPoint, productData.reorderQuantity, productData.leadTimeDays,
              productData.isSerialized, productData.isBatchTracked, productData.isPerishable,
              productData.shelfLifeDays, productData.storageConditions
            ]
          );
          
          results.push({
            success: true,
            product: new Product(result.rows[0]),
            sku: productData.sku
          });
        } catch (error) {
          results.push({
            success: false,
            error: error.message,
            sku: productData.sku
          });
        }
      }
      
      return results;
    });
  }
}

module.exports = Product;