import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, sql } from 'drizzle-orm';
import pg from 'pg';
import * as schema from './schema.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Create connection pool
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
});

// Create drizzle instance
export const db = drizzle(pool, { schema });

// Export all schemas
export {
  // Inventory tables
  inventory,
  inventoryMovements,
  
  // Analytics aggregation tables
  analyticsDailyAggregates,
  analyticsMonthlyAggregates,
  
  // Time-series tables
  timeSeriesMetrics,
  timeSeriesEvents,
  timeSeriesHourlyMetrics,
} from './schema.js';

// Export the entire schema object for migrations
export { schema };

// Helper function to run migrations
export async function runMigrations() {
  try {
    console.log('Running database migrations...');
    await migrate(db, { migrationsFolder: './src/db/migrations' });
    console.log('Migrations completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
}

// Helper function to check database connection
export async function checkConnection() {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    console.log('Database connection successful');
    return true;
  } catch (error) {
    console.error('Database connection failed:', error);
    return false;
  }
}

// Helper function to close database connection
export async function closeConnection() {
  try {
    await pool.end();
    console.log('Database connection closed');
  } catch (error) {
    console.error('Error closing database connection:', error);
  }
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Helper to batch insert inventory movements
 * @param {Array} movements - Array of movement objects
 * @returns {Promise} Insert result
 */
export async function batchInsertMovements(movements) {
  if (!movements || movements.length === 0) return [];
  
  return db.insert(schema.inventoryMovements)
    .values(movements)
    .returning();
}

/**
 * Helper to update inventory levels after movement
 * @param {number} inventoryId - Inventory record ID
 * @param {number} quantity - Quantity to add (positive) or subtract (negative)
 * @param {string} movementType - Type of movement
 * @returns {Promise} Updated inventory record
 */
export async function updateInventoryLevel(inventoryId, quantity, movementType) {
  const currentInventory = await db.query.inventory.findFirst({
    where: (inventory, { eq }) => eq(inventory.id, inventoryId),
  });
  
  if (!currentInventory) {
    throw new Error('Inventory record not found');
  }
  
  let updateData = {
    lastMovement: new Date(),
    updatedAt: new Date(),
  };
  
  // Update quantities based on movement type
  switch (movementType) {
    case 'purchase':
    case 'return':
      updateData.quantityOnHand = currentInventory.quantityOnHand + quantity;
      updateData.quantityAvailable = currentInventory.quantityAvailable + quantity;
      break;
    case 'sale':
      updateData.quantityOnHand = currentInventory.quantityOnHand - quantity;
      updateData.quantityAvailable = currentInventory.quantityAvailable - quantity;
      break;
    case 'transfer':
      // Handle separately based on from/to logic
      break;
    case 'reservation':
      updateData.quantityAvailable = currentInventory.quantityAvailable - quantity;
      updateData.quantityReserved = currentInventory.quantityReserved + quantity;
      break;
  }
  
  // Update stock status
  if (updateData.quantityOnHand !== undefined) {
    if (updateData.quantityOnHand <= 0) {
      updateData.stockStatus = 'out_of_stock';
    } else if (updateData.quantityOnHand <= currentInventory.minStockLevel) {
      updateData.stockStatus = 'low_stock';
    } else {
      updateData.stockStatus = 'in_stock';
    }
  }
  
  return db.update(schema.inventory)
    .set(updateData)
    .where(eq(schema.inventory.id, inventoryId))
    .returning();
}

/**
 * Helper to aggregate daily analytics
 * @param {Date} date - Date to aggregate for
 * @param {string} dimension - Dimension type (product, category, etc.)
 * @returns {Promise} Aggregation result
 */
export async function aggregateDailyAnalytics(date, dimension) {
  // This would contain the logic to aggregate data from various sources
  // and insert into the analytics_daily_aggregates table
  console.log(`Aggregating daily analytics for ${date} - ${dimension}`);
  // Implementation would depend on your specific data sources
}

/**
 * Helper to record time series metric
 * @param {Object} metric - Metric data
 * @returns {Promise} Insert result
 */
export async function recordMetric(metric) {
  return db.insert(schema.timeSeriesMetrics)
    .values({
      timestamp: new Date(),
      ...metric,
    })
    .returning();
}

/**
 * Helper to record analytics event
 * @param {Object} event - Event data
 * @returns {Promise} Insert result
 */
export async function recordEvent(event) {
  return db.insert(schema.timeSeriesEvents)
    .values({
      timestamp: new Date(),
      ...event,
    })
    .returning();
}

/**
 * Helper to get inventory status summary
 * @param {string} warehouseId - Optional warehouse filter
 * @returns {Promise} Inventory status summary
 */
export async function getInventoryStatusSummary(warehouseId = null) {
  const conditions = warehouseId 
    ? sql`WHERE warehouse_id = ${warehouseId}` 
    : sql``;
    
  const result = await db.execute(sql`
    SELECT 
      stock_status,
      COUNT(*) as count,
      SUM(quantity_on_hand) as total_quantity,
      SUM(quantity_on_hand * average_cost) as total_value
    FROM inventory
    ${conditions}
    GROUP BY stock_status
  `);
  
  return result;
}

// Export pool for direct access if needed
export { pool };