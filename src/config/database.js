import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import * as schema from '../db/schema.js';

// Load environment variables
config();

// Validate required environment variables
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

// Create Neon HTTP connection
const sql = neon(process.env.DATABASE_URL, {
  arrayMode: false,
  fullResults: false
});

// Create Drizzle ORM instance with Neon HTTP adapter  
export const db = drizzle(sql, {
  logger: process.env.NODE_ENV === 'development' && process.env.DB_LOGGING !== 'false',
  schema
});

// Enhanced connection test with retry logic
export async function testConnection() {
  const maxRetries = 3;
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Database connection attempt ${attempt}/${maxRetries}...`);
      const result = await sql`SELECT 1 as test`;
      console.log('✅ Database connection successful with enhanced HTTP client');
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

// Mock pool statistics for HTTP connections with connection tracking
let connectionCount = 0;
let lastConnectionTime = null;
let connectionErrors = 0;
let lastError = null;

// Wrap SQL function to track connection statistics
const originalSql = sql;
export const trackedSql = async (...args) => {
  try {
    connectionCount++;
    lastConnectionTime = new Date();
    const result = await originalSql(...args);
    return result;
  } catch (error) {
    connectionErrors++;
    lastError = error;
    throw error;
  }
};

// Export enhanced pool statistics
export function getPoolStats() {
  return {
    totalConnections: connectionCount,
    idleConnections: 0, // HTTP connections don't idle
    activeConnections: 1, // Simulated active connection
    waitingRequests: 0,
    errors: connectionErrors,
    lastError: lastError?.message || null,
    totalCount: connectionCount,
    idleCount: 0,
    waitingCount: 0,
    lastConnectionTime: lastConnectionTime,
    connectionType: 'HTTP',
    timeoutMs: parseInt(process.env.DATABASE_CONNECTION_TIMEOUT || '15000')
  };
}

// Graceful shutdown function (no-op for HTTP connections)
export async function closePool() {
  console.log('✅ Database HTTP client - no pool to close');
  return Promise.resolve();
}

export default db;