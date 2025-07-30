import { config } from 'dotenv';
import mysql from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import * as mysqlSchema from '../db/mysql-schema.js';

// Load environment variables
config();

// Validate required MySQL environment variables
const requiredEnvVars = [
  'MYSQL_HOST',
  'MYSQL_PORT', 
  'MYSQL_DATABASE',
  'MYSQL_USER',
  'MYSQL_PASSWORD'
];

const legacyEnvVars = [
  'DB_HOST',
  'DB_PORT',
  'DB_NAME', 
  'DB_USER',
  'DB_PASSWORD'
];

// Use legacy variables if MYSQL_ prefixed ones aren't available
const hasLegacyVars = legacyEnvVars.every(varName => process.env[varName]);
const hasMysqlVars = requiredEnvVars.some(varName => process.env[varName]);

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0 && !hasLegacyVars) {
  console.warn(`⚠️ Missing MySQL environment variables: ${missingVars.join(', ')}`);
  console.warn('MySQL connection will be disabled. Please configure these variables to enable MySQL support.');
} else if (hasLegacyVars && !hasMysqlVars) {
  console.log('📊 Using legacy DB_ environment variables for MySQL connection');
}

// MySQL connection configuration with NXT platform defaults
const mysqlConfig = {
  host: process.env.MYSQL_HOST || process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PORT || process.env.DB_PORT) || 3306,
  database: process.env.MYSQL_DATABASE || process.env.DB_NAME || 'NXTLEVELTECH',
  user: process.env.MYSQL_USER || process.env.DB_USER || 'nxtextract',
  password: process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD || 'nxtextract123',
  
  // Connection pool settings
  connectionLimit: parseInt(process.env.MYSQL_CONNECTION_LIMIT) || 20,
  queueLimit: parseInt(process.env.MYSQL_QUEUE_LIMIT) || 0,
  acquireTimeout: parseInt(process.env.MYSQL_ACQUIRE_TIMEOUT) || 60000,
  timeout: parseInt(process.env.MYSQL_TIMEOUT) || 60000,
  reconnect: true,
  
  // SSL Configuration (for production)
  ssl: process.env.NODE_ENV === 'production' ? {
    rejectUnauthorized: process.env.MYSQL_SSL_REJECT_UNAUTHORIZED !== 'false'
  } : false,
  
  // Character set and timezone
  charset: 'utf8mb4',
  timezone: 'Z',
  
  // Performance optimizations
  supportBigNumbers: true,
  bigNumberStrings: true,
  dateStrings: false,
  debug: process.env.NODE_ENV === 'development' && process.env.MYSQL_DEBUG === 'true',
  
  // Connection flags
  flags: [
    'COMPRESS',
    'PROTOCOL_41',
    'TRANSACTIONS',
    'RESERVED',
    'SECURE_CONNECTION',
    'MULTI_STATEMENTS',
    'MULTI_RESULTS'
  ]
};

// Create MySQL connection pool
let mysqlPool = null;
let mysqlDb = null;

// Initialize MySQL connection only if environment variables are provided
const initializeMysqlConnection = () => {
  if (missingVars.length > 0 && !hasLegacyVars) {
    console.log('📊 MySQL integration skipped - missing configuration');
    return { pool: null, db: null };
  }

  try {
    // Create connection pool
    mysqlPool = mysql.createPool(mysqlConfig);
    
    // Create Drizzle ORM instance with MySQL adapter
    mysqlDb = drizzle(mysqlPool, {
      logger: process.env.NODE_ENV === 'development' && process.env.MYSQL_LOGGING !== 'false',
      schema: mysqlSchema,
      mode: 'default'
    });

    console.log('✅ MySQL connection pool initialized successfully');
    return { pool: mysqlPool, db: mysqlDb };
  } catch (error) {
    console.error('❌ Failed to initialize MySQL connection:', error.message);
    return { pool: null, db: null };
  }
};

// Initialize connection
const { pool, db } = initializeMysqlConnection();

// Export MySQL connection instances
export { mysqlPool, mysqlDb, mysqlConfig };
export const mysql_pool = pool;
export const mysql_db = db;

// Connection statistics tracking
let connectionStats = {
  totalConnections: 0,
  activeConnections: 0,
  errorCount: 0,
  lastError: null,
  lastConnectionTime: null,
  reconnectCount: 0
};

// Enhanced connection test with retry logic
export async function testMysqlConnection() {
  if (!mysqlPool) {
    console.log('📊 MySQL connection test skipped - not configured');
    return false;
  }

  const maxRetries = 3;
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔍 MySQL connection attempt ${attempt}/${maxRetries}...`);
      
      const connection = await mysqlPool.getConnection();
      const [result] = await connection.execute('SELECT 1 as test, DATABASE() as database_name, VERSION() as mysql_version');
      connection.release();
      
      connectionStats.totalConnections++;
      connectionStats.lastConnectionTime = new Date();
      
      console.log('✅ MySQL connection successful');
      console.log(`📊 Database: ${result[0].database_name}, Version: ${result[0].mysql_version}`);
      return true;
      
    } catch (error) {
      lastError = error;
      connectionStats.errorCount++;
      connectionStats.lastError = error.message;
      
      console.warn(`❌ MySQL connection attempt ${attempt} failed:`, error.message);
      
      if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
        console.warn('🔧 Connection timeout/refused - check MySQL server status');
      } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
        console.warn('🔐 Access denied - check MySQL credentials');
      } else if (error.code === 'ER_BAD_DB_ERROR') {
        console.warn('🗃️ Database not found - check database name');
      }
      
      // Wait before retry (exponential backoff)
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
        console.log(`⏱️ Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  console.error('💥 All MySQL connection attempts failed. Last error:', lastError?.message);
  return false;
}

// Get MySQL pool statistics
export function getMysqlPoolStats() {
  if (!mysqlPool) {
    return {
      status: 'disabled',
      reason: 'MySQL not configured'
    };
  }

  return {
    status: 'active',
    connectionLimit: mysqlConfig.connectionLimit,
    activeConnections: mysqlPool._allConnections?.length || 0,
    idleConnections: mysqlPool._freeConnections?.length || 0,
    queuedRequests: mysqlPool._connectionQueue?.length || 0,
    
    // Statistics
    totalConnections: connectionStats.totalConnections,
    errorCount: connectionStats.errorCount,
    lastError: connectionStats.lastError,
    lastConnectionTime: connectionStats.lastConnectionTime,
    reconnectCount: connectionStats.reconnectCount,
    
    // Configuration
    config: {
      host: mysqlConfig.host,
      port: mysqlConfig.port,
      database: mysqlConfig.database,
      user: mysqlConfig.user,
      connectionLimit: mysqlConfig.connectionLimit,
      acquireTimeout: mysqlConfig.acquireTimeout,
      timeout: mysqlConfig.timeout
    }
  };
}

// Run MySQL migrations
export async function runMysqlMigrations() {
  if (!mysqlDb) {
    console.log('📊 MySQL migrations skipped - not configured');
    return false;
  }

  try {
    console.log('🔄 Running MySQL migrations...');
    await migrate(mysqlDb, { migrationsFolder: './src/db/mysql-migrations' });
    console.log('✅ MySQL migrations completed successfully');
    return true;
  } catch (error) {
    console.error('❌ MySQL migration failed:', error.message);
    throw error;
  }
}

// Check MySQL connection health
export async function checkMysqlHealth() {
  if (!mysqlPool) {
    return {
      status: 'disabled',
      healthy: false,
      message: 'MySQL not configured'
    };
  }

  try {
    const connection = await mysqlPool.getConnection();
    const [result] = await connection.execute('SELECT 1 as health_check');
    connection.release();
    
    return {
      status: 'active',
      healthy: true,
      message: 'MySQL connection healthy',
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      status: 'error',
      healthy: false,
      message: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

// Graceful MySQL connection shutdown
export async function closeMysqlPool() {
  if (!mysqlPool) {
    console.log('📊 MySQL pool closure skipped - not configured');
    return;
  }

  try {
    console.log('🔄 Closing MySQL connection pool...');
    await mysqlPool.end();
    console.log('✅ MySQL connection pool closed successfully');
  } catch (error) {
    console.error('❌ Error closing MySQL pool:', error.message);
    throw error;
  }
}

// MySQL transaction helper
export async function withMysqlTransaction(callback) {
  if (!mysqlPool) {
    throw new Error('MySQL not configured');
  }

  const connection = await mysqlPool.getConnection();
  await connection.beginTransaction();
  
  try {
    const result = await callback(connection);
    await connection.commit();
    connection.release();
    return result;
  } catch (error) {
    await connection.rollback();
    connection.release();
    throw error;
  }
}

// MySQL batch operations helper
export async function executeMysqlBatch(queries) {
  if (!mysqlPool) {
    throw new Error('MySQL not configured');
  }

  const connection = await mysqlPool.getConnection();
  const results = [];
  
  try {
    for (const query of queries) {
      const [result] = await connection.execute(query.sql, query.params || []);
      results.push(result);
    }
    connection.release();
    return results;
  } catch (error) {
    connection.release();
    throw error;
  }
}

// Performance monitoring
export function setupMysqlMonitoring() {
  if (!mysqlPool) {
    console.log('📊 MySQL monitoring skipped - not configured');
    return;
  }

  // Monitor connection events
  mysqlPool.on('connection', (connection) => {
    connectionStats.totalConnections++;
    connectionStats.activeConnections++;
    connectionStats.lastConnectionTime = new Date();
    console.log(`🔗 MySQL connection established (ID: ${connection.threadId})`);
  });

  mysqlPool.on('error', (error) => {
    connectionStats.errorCount++;
    connectionStats.lastError = error.message;
    console.error('❌ MySQL pool error:', error.message);
    
    if (error.code === 'PROTOCOL_CONNECTION_LOST') {
      connectionStats.reconnectCount++;
      console.log('🔄 MySQL connection lost, attempting to reconnect...');
    }
  });

  console.log('📊 MySQL connection monitoring enabled');
}

// Initialize monitoring if MySQL is configured
if (mysqlPool) {
  setupMysqlMonitoring();
}

// Compatibility layer for existing PostgreSQL code
export const mysqlCompatibility = {
  // Map PostgreSQL functions to MySQL equivalents
  getCurrentTimestamp: () => 'NOW()',
  getUuid: () => 'UUID()',
  jsonb: (field) => `JSON_EXTRACT(${field}, '$')`,
  arrayAgg: (field) => `JSON_ARRAYAGG(${field})`,
  objectAgg: (key, value) => `JSON_OBJECTAGG(${key}, ${value})`
};

export default {
  pool: mysqlPool,
  db: mysqlDb,
  config: mysqlConfig,
  testConnection: testMysqlConnection,
  getPoolStats: getMysqlPoolStats,
  runMigrations: runMysqlMigrations,
  checkHealth: checkMysqlHealth,
  closePool: closeMysqlPool,
  withTransaction: withMysqlTransaction,
  executeBatch: executeMysqlBatch,
  compatibility: mysqlCompatibility
};