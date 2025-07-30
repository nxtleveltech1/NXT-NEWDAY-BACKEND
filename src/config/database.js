import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import * as schema from '../db/schema.js';

// Load environment variables
config();

// Validate required environment variables
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

// Create PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Create Drizzle ORM instance with PostgreSQL adapter
export const db = drizzle(pool, {
  logger: process.env.NODE_ENV === 'development' && process.env.DB_LOGGING !== 'false',
  schema
});

// Export sql utility for raw queries
export { sql };

// Export pool for backward compatibility
export { pool };

// Export only the specific schemas that were originally exported
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
} from '../db/schema.js';

// Export the entire schema object for migrations
export { schema };

// Enhanced connection test with retry logic
export async function testConnection() {
  const maxRetries = 3;
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Database connection attempt ${attempt}/${maxRetries}...`);
      const client = await pool.connect();
      const result = await client.query('SELECT 1 as test');
      client.release();
      console.log('✅ Database connection successful with PostgreSQL client');
      return true;
    } catch (error) {
      lastError = error;
      console.warn(`❌ Connection attempt ${attempt} failed:`, error.message);
      
      if (error.message.includes('ETIMEDOUT') || error.name === 'TimeoutError') {
        console.warn('🔧 Timeout detected - this should be improved with new timeout settings');
      }
      
      // Wait before retry (exponential backoff)
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
        console.log(`⏱️ Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  console.error('💥 All connection attempts failed. Last error:', lastError?.message);
  return false;
}

// Mock pool statistics for PostgreSQL connections
let connectionCount = 0;
let lastConnectionTime = null;
let connectionErrors = 0;
let lastError = null;

// Wrap pool connect function to track connection statistics
const originalConnect = pool.connect;
pool.connect = async (...args) => {
  try {
    connectionCount++;
    lastConnectionTime = new Date();
    const client = await originalConnect.apply(pool, args);
    return client;
  } catch (error) {
    connectionErrors++;
    lastError = error;
    throw error;
  }
};

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
    const result = await client.query('SELECT 1 as test');
    client.release();
    console.log('✅ Database connection successful');
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    return false;
  }
}

// Export enhanced pool statistics
export function getPoolStats() {
  return {
    totalConnections: connectionCount,
    idleConnections: pool.idleCount || 0,
    activeConnections: pool.totalCount - (pool.idleCount || 0),
    waitingRequests: pool.waitingCount || 0,
    errors: connectionErrors,
    lastError: lastError?.message || null,
    totalCount: pool.totalCount || 0,
    idleCount: pool.idleCount || 0,
    waitingCount: pool.waitingCount || 0,
    lastConnectionTime: lastConnectionTime,
    connectionType: 'PostgreSQL',
    timeoutMs: parseInt(process.env.DATABASE_CONNECTION_TIMEOUT || '15000')
  };
}

// Graceful shutdown function
export async function closePool() {
  console.log('✅ Closing PostgreSQL connection pool...');
  await pool.end();
  console.log('✅ PostgreSQL connection pool closed');
  return Promise.resolve();
}

// Alias for backward compatibility
export const closeConnection = closePool;

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

export default db;