import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import * as schema from '../db/schema.js';

// Load environment variables
config();

// Configure Neon for local development (if needed)
if (process.env.NODE_ENV !== 'production') {
  // Set WebSocket implementation for local development
  neonConfig.webSocketConstructor = ws;
}

// Validate required environment variables
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

// Create connection pool with optimized settings for performance
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Optimized connection pool settings
  min: parseInt(process.env.DB_POOL_MIN || '5'), // Increased minimum for better performance
  max: parseInt(process.env.DB_POOL_MAX || '20'), // Increased max for high concurrency
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '10000'), // Reduced idle timeout
  connectionTimeoutMillis: 5000,
  // Keep connections alive
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  // Statement timeout for long-running queries
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT || '30000'),
  // Query timeout
  query_timeout: parseInt(process.env.DB_QUERY_TIMEOUT || '30000'),
  // SSL is required for Neon
  ssl: {
    rejectUnauthorized: true
  }
});

// Create Drizzle ORM instance with Neon serverless adapter
export const db = drizzle(pool, {
  logger: process.env.NODE_ENV === 'development',
  schema
});

// Pool monitoring
let poolStats = {
  totalConnections: 0,
  idleConnections: 0,
  activeConnections: 0,
  waitingRequests: 0,
  errors: 0,
  lastError: null
};

// Monitor pool events
pool.on('connect', () => {
  poolStats.totalConnections++;
});

pool.on('acquire', () => {
  poolStats.activeConnections++;
  poolStats.idleConnections = Math.max(0, poolStats.idleConnections - 1);
});

pool.on('release', () => {
  poolStats.activeConnections = Math.max(0, poolStats.activeConnections - 1);
  poolStats.idleConnections++;
});

pool.on('error', (err) => {
  poolStats.errors++;
  poolStats.lastError = err.message;
  console.error('Pool error:', err);
});

// Export pool statistics
export function getPoolStats() {
  return {
    ...poolStats,
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount
  };
}

// Database connection test function
export async function testConnection() {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT 1');
    client.release();
    console.log('Database connection successful');
    return true;
  } catch (error) {
    console.error('Database connection failed:', error);
    return false;
  }
}

// Graceful shutdown handler
export async function closeDatabase() {
  try {
    await pool.end();
    console.log('Database pool closed');
  } catch (error) {
    console.error('Error closing database pool:', error);
  }
}

// Handle process termination
process.on('SIGINT', async () => {
  await closeDatabase();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closeDatabase();
  process.exit(0);
});

export default db;