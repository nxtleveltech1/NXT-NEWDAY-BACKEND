import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';

/**
 * NileDB Configuration - PRODUCTION ONLY
 * PostgreSQL connection for real-time dashboard data
 */

const NILEDB_CONNECTION_STRING = 'postgres://019864b1-5486-74e4-b499-5c3c20e5d483:933d9c72-25b1-4078-b0f4-ca227857b75a@eu-central-1.db.thenile.dev:5432/NILEDB';

// Create NileDB connection pool
const nilePool = new Pool({
  connectionString: NILEDB_CONNECTION_STRING,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: {
    rejectUnauthorized: false
  }
});

// Create Drizzle ORM instance for NileDB
export const nileDb = drizzle(nilePool, {
  logger: process.env.NODE_ENV === 'development'
});

// Connection health monitoring
let connectionStatus = {
  isHealthy: false,
  lastCheck: null,
  errorCount: 0,
  lastError: null
};

/**
 * Test NileDB connection
 */
export async function testNileConnection() {
  try {
    const client = await nilePool.connect();
    const result = await client.query('SELECT NOW() as current_time, version() as version');
    client.release();
    
    connectionStatus = {
      isHealthy: true,
      lastCheck: new Date(),
      errorCount: 0,
      lastError: null
    };
    
    console.log('✅ NileDB connection successful:', result.rows[0]);
    return { success: true, data: result.rows[0] };
  } catch (error) {
    connectionStatus = {
      isHealthy: false,
      lastCheck: new Date(),
      errorCount: connectionStatus.errorCount + 1,
      lastError: error.message
    };
    
    console.error('❌ NileDB connection failed:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Get connection status
 */
export function getNileConnectionStatus() {
  return {
    ...connectionStatus,
    poolStats: {
      totalCount: nilePool.totalCount,
      idleCount: nilePool.idleCount,
      waitingCount: nilePool.waitingCount
    }
  };
}

/**
 * Initialize NileDB tables for dashboard data
 */
export async function initializeNileDB() {
  const client = await nilePool.connect();
  try {
    // Update existing suppliers to ensure is_active is not null
    try {
      await client.query('UPDATE suppliers SET is_active = true WHERE is_active IS NULL');
      console.log('✅ Updated existing suppliers is_active field');
    } catch (updateError) {
      // If update fails, suppliers table might not exist yet, which is fine
      console.log('ℹ️ Suppliers table update skipped (table may not exist yet)');
    }

    // Create dashboard data tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS dashboard_metrics (
        id SERIAL PRIMARY KEY,
        metric_name VARCHAR(100) NOT NULL,
        metric_value DECIMAL(15,2),
        metric_type VARCHAR(50) DEFAULT 'counter',
        timestamp TIMESTAMP DEFAULT NOW(),
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS dashboard_events (
        id SERIAL PRIMARY KEY,
        event_type VARCHAR(100) NOT NULL,
        event_data JSONB NOT NULL,
        event_source VARCHAR(100) DEFAULT 'system',
        severity VARCHAR(20) DEFAULT 'info',
        timestamp TIMESTAMP DEFAULT NOW(),
        processed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS real_time_data (
        id SERIAL PRIMARY KEY,
        data_type VARCHAR(100) NOT NULL,
        data_payload JSONB NOT NULL,
        timestamp TIMESTAMP DEFAULT NOW(),
        expires_at TIMESTAMP DEFAULT (NOW() + INTERVAL '1 hour'),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Create indexes for better performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_suppliers_active_name 
      ON suppliers (is_active, name);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_dashboard_metrics_name_time 
      ON dashboard_metrics (metric_name, timestamp DESC);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_dashboard_events_type_time 
      ON dashboard_events (event_type, timestamp DESC);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_real_time_data_type_time 
      ON real_time_data (data_type, timestamp DESC);
    `);

    console.log('✅ NileDB tables initialized successfully');
    return { success: true };
  } catch (error) {
    console.error('❌ Failed to initialize NileDB tables:', error);
    return { success: false, error: error.message };
  } finally {
    client.release();
  }
}

/**
 * Insert dashboard metric
 */
export async function insertDashboardMetric(name, value, type = 'counter', metadata = {}) {
  const client = await nilePool.connect();
  try {
    const result = await client.query(
      'INSERT INTO dashboard_metrics (metric_name, metric_value, metric_type, metadata) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, value, type, JSON.stringify(metadata)]
    );
    return { success: true, data: result.rows[0] };
  } catch (error) {
    console.error('Error inserting dashboard metric:', error);
    return { success: false, error: error.message };
  } finally {
    client.release();
  }
}

/**
 * Get dashboard metrics
 */
export async function getDashboardMetrics(timeRange = '24h', limit = 100) {
  const client = await nilePool.connect();
  try {
    const timeCondition = timeRange === '24h' 
      ? "timestamp >= NOW() - INTERVAL '24 hours'"
      : timeRange === '7d'
      ? "timestamp >= NOW() - INTERVAL '7 days'"
      : timeRange === '30d'
      ? "timestamp >= NOW() - INTERVAL '30 days'"
      : "timestamp >= NOW() - INTERVAL '24 hours'";

    const result = await client.query(`
      SELECT * FROM dashboard_metrics 
      WHERE ${timeCondition}
      ORDER BY timestamp DESC 
      LIMIT $1
    `, [limit]);

    return { success: true, data: result.rows };
  } catch (error) {
    console.error('Error getting dashboard metrics:', error);
    return { success: false, error: error.message };
  } finally {
    client.release();
  }
}

/**
 * Insert dashboard event
 */
export async function insertDashboardEvent(type, data, source = 'system', severity = 'info') {
  const client = await nilePool.connect();
  try {
    const result = await client.query(
      'INSERT INTO dashboard_events (event_type, event_data, event_source, severity) VALUES ($1, $2, $3, $4) RETURNING *',
      [type, JSON.stringify(data), source, severity]
    );
    return { success: true, data: result.rows[0] };
  } catch (error) {
    console.error('Error inserting dashboard event:', error);
    return { success: false, error: error.message };
  } finally {
    client.release();
  }
}

/**
 * Get recent dashboard events
 */
export async function getDashboardEvents(limit = 50, eventType = null) {
  const client = await nilePool.connect();
  try {
    let query = 'SELECT * FROM dashboard_events';
    let params = [limit];
    
    if (eventType) {
      query += ' WHERE event_type = $2';
      params.push(eventType);
    }
    
    query += ' ORDER BY timestamp DESC LIMIT $1';

    const result = await client.query(query, params);
    return { success: true, data: result.rows };
  } catch (error) {
    console.error('Error getting dashboard events:', error);
    return { success: false, error: error.message };
  } finally {
    client.release();
  }
}

/**
 * Store real-time data
 */
export async function storeRealTimeData(dataType, payload, expiresInHours = 1) {
  const client = await nilePool.connect();
  try {
    const result = await client.query(
      `INSERT INTO real_time_data (data_type, data_payload, expires_at) VALUES ($1, $2, NOW() + INTERVAL '${expiresInHours} hours') RETURNING *`,
      [dataType, JSON.stringify(payload)]
    );
    return { success: true, data: result.rows[0] };
  } catch (error) {
    console.error('Error storing real-time data:', error);
    return { success: false, error: error.message };
  } finally {
    client.release();
  }
}

/**
 * Get real-time data
 */
export async function getRealTimeData(dataType, limit = 100) {
  const client = await nilePool.connect();
  try {
    const result = await client.query(
      'SELECT * FROM real_time_data WHERE data_type = $1 AND expires_at > NOW() ORDER BY timestamp DESC LIMIT $2',
      [dataType, limit]
    );
    return { success: true, data: result.rows };
  } catch (error) {
    console.error('Error getting real-time data:', error);
    return { success: false, error: error.message };
  } finally {
    client.release();
  }
}

/**
 * Cleanup expired data
 */
export async function cleanupExpiredData() {
  const client = await nilePool.connect();
  try {
    const result = await client.query('DELETE FROM real_time_data WHERE expires_at <= NOW()');
    console.log(`Cleaned up ${result.rowCount} expired real-time data records`);
    return { success: true, deletedCount: result.rowCount };
  } catch (error) {
    console.error('Error cleaning up expired data:', error);
    return { success: false, error: error.message };
  } finally {
    client.release();
  }
}

/**
 * Close NileDB connection pool
 */
export async function closeNilePool() {
  try {
    await nilePool.end();
    console.log('✅ NileDB connection pool closed');
  } catch (error) {
    console.error('❌ Error closing NileDB pool:', error);
  }
}

// Export pool for direct access if needed
export { nilePool };