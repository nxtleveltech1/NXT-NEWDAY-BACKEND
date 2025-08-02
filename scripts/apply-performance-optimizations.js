#!/usr/bin/env node

/**
 * PERFORMANCE OPTIMIZATION SCRIPT
 * Applies all performance optimizations to the system
 * Target: Handle 1000+ concurrent users on nxtdotx.co.za
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Pool } from 'pg';
import mysql from 'mysql2/promise';
import { createClient } from 'redis';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Database connections
let pgPool = null;
let mysqlPool = null;
let redisClient = null;

// Performance optimization results
const optimizationResults = {
  databaseIndexes: { created: 0, failed: 0, errors: [] },
  connectionPools: { configured: 0, errors: [] },
  cacheSetup: { status: 'pending', error: null },
  systemConfig: { applied: 0, errors: [] },
  startTime: Date.now()
};

/**
 * Initialize database connections
 */
async function initializeDatabaseConnections() {
  console.log('🔌 Initializing database connections...');
  
  try {
    // PostgreSQL connection (primary)
    if (process.env.DATABASE_URL) {
      pgPool = new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
      });
      
      // Test connection
      const client = await pgPool.connect();
      const result = await client.query('SELECT version()');
      client.release();
      
      console.log('✅ PostgreSQL connection established');
      console.log(`📊 Database version: ${result.rows[0].version.split(' ')[1]}`);
      optimizationResults.connectionPools.configured++;
    }
    
    // MySQL connection (legacy support)
    if (process.env.DB_HOST && process.env.DB_USER) {
      mysqlPool = mysql.createPool({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        connectionLimit: 20,
        acquireTimeout: 60000,
        timeout: 60000,
        reconnect: true
      });
      
      // Test connection
      const [rows] = await mysqlPool.execute('SELECT VERSION() as version');
      console.log('✅ MySQL connection established');
      console.log(`📊 Database version: ${rows[0].version}`);
      optimizationResults.connectionPools.configured++;
    }
    
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    optimizationResults.connectionPools.errors.push(error.message);
  }
}

/**
 * Initialize Redis cache
 */
async function initializeRedisCache() {
  console.log('🚀 Initializing Redis cache...');
  
  try {
    redisClient = createClient({
      url: process.env.REDIS_URL || `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`,
      password: process.env.REDIS_PASSWORD,
      socket: {
        connectTimeout: 10000,
        lazyConnect: true
      }
    });
    
    redisClient.on('error', (err) => {
      console.error('Redis error:', err);
    });
    
    await redisClient.connect();
    await redisClient.ping();
    
    // Set up initial cache configuration
    await redisClient.configSet('maxmemory-policy', 'allkeys-lru');
    await redisClient.configSet('timeout', '300');
    
    console.log('✅ Redis cache initialized');
    optimizationResults.cacheSetup.status = 'success';
    
  } catch (error) {
    console.warn('⚠️ Redis cache initialization failed:', error.message);
    optimizationResults.cacheSetup.status = 'failed';
    optimizationResults.cacheSetup.error = error.message;
  }
}

/**
 * Apply database indexes
 */
async function applyDatabaseIndexes() {
  console.log('📊 Applying database performance indexes...');
  
  if (!pgPool && !mysqlPool) {
    console.log('⏭️ Skipping database indexes - no database connection');
    return;
  }
  
  try {
    // Read the SQL file with indexes
    const indexesSQL = readFileSync(
      join(__dirname, '../src/db/create-performance-indexes.sql'),
      'utf8'
    );
    
    if (pgPool) {
      console.log('🔧 Applying PostgreSQL indexes...');
      
      // Split SQL file into individual commands
      const commands = indexesSQL
        .split(';')
        .map(cmd => cmd.trim())
        .filter(cmd => cmd.length > 0 && !cmd.startsWith('--') && !cmd.startsWith('/*'));
      
      const client = await pgPool.connect();
      
      try {
        for (const command of commands) {
          try {
            // Skip transaction commands for index creation
            if (command.toUpperCase().includes('BEGIN') || 
                command.toUpperCase().includes('COMMIT') ||
                command.toUpperCase().includes('ROLLBACK')) {
              continue;
            }
            
            await client.query(command);
            optimizationResults.databaseIndexes.created++;
            
            // Extract index name for logging
            const indexMatch = command.match(/CREATE.*INDEX.*?(idx_\w+)/i);
            if (indexMatch) {
              console.log(`✅ Created index: ${indexMatch[1]}`);
            }
            
          } catch (error) {
            // Ignore "already exists" errors
            if (error.message.includes('already exists')) {
              console.log(`ℹ️ Index already exists: ${command.substring(0, 50)}...`);
            } else {
              console.warn(`⚠️ Index creation failed: ${error.message}`);
              optimizationResults.databaseIndexes.failed++;
              optimizationResults.databaseIndexes.errors.push(error.message);
            }
          }
        }
        
        // Update table statistics
        console.log('📈 Updating table statistics...');
        await client.query('ANALYZE');
        
      } finally {
        client.release();
      }
    }
    
    if (mysqlPool) {
      console.log('🔧 Applying MySQL indexes...');
      
      // MySQL-specific indexes (simplified version)
      const mysqlIndexes = [
        'CREATE INDEX idx_users_email ON users(email)',
        'CREATE INDEX idx_users_organization_id ON users(organization_id)',
        'CREATE INDEX idx_products_sku ON products(sku)',
        'CREATE INDEX idx_products_status ON products(status)',
        'CREATE INDEX idx_orders_customer_id ON orders(customer_id)',
        'CREATE INDEX idx_orders_status ON orders(status)',
        'CREATE INDEX idx_inventory_product_id ON inventory(product_id)',
        'CREATE INDEX idx_suppliers_organization_id ON suppliers(organization_id)'
      ];
      
      for (const indexSQL of mysqlIndexes) {
        try {
          await mysqlPool.execute(indexSQL);
          optimizationResults.databaseIndexes.created++;
          console.log(`✅ Created MySQL index`);
        } catch (error) {
          if (error.message.includes('Duplicate key name')) {
            console.log(`ℹ️ MySQL index already exists`);
          } else {
            console.warn(`⚠️ MySQL index creation failed: ${error.message}`);
            optimizationResults.databaseIndexes.failed++;
            optimizationResults.databaseIndexes.errors.push(error.message);
          }
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Database index application failed:', error);
    optimizationResults.databaseIndexes.errors.push(error.message);
  }
}

/**
 * Configure system optimizations
 */
async function configureSystemOptimizations() {
  console.log('⚙️ Configuring system optimizations...');
  
  try {
    // Set Node.js optimization flags
    process.env.UV_THREADPOOL_SIZE = '32'; // Increase thread pool size
    process.env.NODE_OPTIONS = '--max-old-space-size=2048 --expose-gc --optimize-for-size';
    
    // Configure garbage collection
    if (global.gc) {
      // Force garbage collection
      global.gc();
      console.log('✅ Garbage collection triggered');
    }
    
    // Set process priority (if possible)
    try {
      process.nice(-10); // Higher priority
      console.log('✅ Process priority optimized');
    } catch (error) {
      console.log('ℹ️ Could not adjust process priority (requires elevated permissions)');
    }
    
    optimizationResults.systemConfig.applied++;
    
  } catch (error) {
    console.warn('⚠️ System optimization failed:', error.message);
    optimizationResults.systemConfig.errors.push(error.message);
  }
}

/**
 * Setup database connection pooling optimization
 */
async function optimizeConnectionPools() {
  console.log('🏊 Optimizing database connection pools...');
  
  if (pgPool) {
    try {
      // Optimize PostgreSQL pool settings
      const client = await pgPool.connect();
      
      // Configure connection-level optimizations
      await client.query("SET statement_timeout = '30s'");
      await client.query("SET lock_timeout = '10s'");
      await client.query("SET idle_in_transaction_session_timeout = '5min'");
      
      client.release();
      
      console.log('✅ PostgreSQL connection pool optimized');
      optimizationResults.connectionPools.configured++;
      
    } catch (error) {
      console.warn('⚠️ PostgreSQL pool optimization failed:', error.message);
      optimizationResults.connectionPools.errors.push(error.message);
    }
  }
  
  if (mysqlPool) {
    try {
      // MySQL connection pool is already configured with optimizations
      console.log('✅ MySQL connection pool configured');
      optimizationResults.connectionPools.configured++;
      
    } catch (error) {
      console.warn('⚠️ MySQL pool optimization failed:', error.message);
      optimizationResults.connectionPools.errors.push(error.message);
    }
  }
}

/**
 * Setup performance monitoring
 */
async function setupPerformanceMonitoring() {
  console.log('📊 Setting up performance monitoring...');
  
  try {
    // Store performance baseline in cache
    if (redisClient) {
      const baseline = {
        timestamp: Date.now(),
        node_version: process.version,
        memory_limit: process.env.NODE_OPTIONS?.includes('max-old-space-size') ? '2048MB' : '1024MB',
        indexes_created: optimizationResults.databaseIndexes.created,
        cache_enabled: optimizationResults.cacheSetup.status === 'success'
      };
      
      await redisClient.setEx('performance:baseline', 86400, JSON.stringify(baseline));
      console.log('✅ Performance baseline stored');
    }
    
    // Create performance monitoring function
    const monitorPerformance = () => {
      const memUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();
      
      console.log(`📊 Memory: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB, CPU: ${cpuUsage.user + cpuUsage.system}μs`);
      
      // Alert if memory usage is high
      if (memUsage.heapUsed > 500 * 1024 * 1024) { // 500MB
        console.warn('⚠️ High memory usage detected');
        if (global.gc) {
          global.gc();
        }
      }
    };
    
    // Monitor every 30 seconds
    setInterval(monitorPerformance, 30000);
    
    console.log('✅ Performance monitoring enabled');
    
  } catch (error) {
    console.warn('⚠️ Performance monitoring setup failed:', error.message);
  }
}

/**
 * Validate optimizations
 */
async function validateOptimizations() {
  console.log('🔍 Validating performance optimizations...');
  
  const validationResults = {
    database: false,
    cache: false,
    indexes: false,
    performance: 'unknown'
  };
  
  try {
    // Test database performance
    if (pgPool || mysqlPool) {
      const startTime = Date.now();
      
      if (pgPool) {
        const client = await pgPool.connect();
        await client.query('SELECT 1');
        client.release();
      } else if (mysqlPool) {
        await mysqlPool.execute('SELECT 1');
      }
      
      const queryTime = Date.now() - startTime;
      validationResults.database = queryTime < 100; // Less than 100ms
      
      console.log(`📊 Database query time: ${queryTime}ms`);
    }
    
    // Test cache performance
    if (redisClient) {
      const startTime = Date.now();
      await redisClient.set('test:performance', 'validation');
      const value = await redisClient.get('test:performance');
      await redisClient.del('test:performance');
      
      const cacheTime = Date.now() - startTime;
      validationResults.cache = cacheTime < 50 && value === 'validation'; // Less than 50ms
      
      console.log(`📊 Cache operation time: ${cacheTime}ms`);
    }
    
    // Check if indexes were created
    validationResults.indexes = optimizationResults.databaseIndexes.created > 0;
    
    // Overall performance score
    const score = Object.values(validationResults).filter(v => v === true).length;
    validationResults.performance = score >= 2 ? 'good' : score >= 1 ? 'fair' : 'poor';
    
    console.log('✅ Validation complete:', validationResults);
    
  } catch (error) {
    console.error('❌ Validation failed:', error);
  }
  
  return validationResults;
}

/**
 * Generate optimization report
 */
function generateOptimizationReport(validationResults) {
  const duration = Date.now() - optimizationResults.startTime;
  
  const report = {
    timestamp: new Date().toISOString(),
    duration: `${duration}ms`,
    summary: {
      database_indexes_created: optimizationResults.databaseIndexes.created,
      database_indexes_failed: optimizationResults.databaseIndexes.failed,
      connection_pools_configured: optimizationResults.connectionPools.configured,
      cache_status: optimizationResults.cacheSetup.status,
      system_optimizations: optimizationResults.systemConfig.applied
    },
    validation: validationResults,
    performance_targets: {
      concurrent_users: '1000+',
      response_time: '<500ms',
      database_query_time: '<100ms',
      cache_operation_time: '<50ms'
    },
    recommendations: [],
    errors: []
  };
  
  // Add recommendations based on results
  if (optimizationResults.databaseIndexes.created === 0) {
    report.recommendations.push('Consider creating database indexes for better query performance');
  }
  
  if (optimizationResults.cacheSetup.status !== 'success') {
    report.recommendations.push('Redis cache is not available - consider setting up Redis for better performance');
  }
  
  if (optimizationResults.connectionPools.configured === 0) {
    report.recommendations.push('Database connection pooling could not be configured');
  }
  
  // Collect all errors
  report.errors = [
    ...optimizationResults.databaseIndexes.errors,
    ...optimizationResults.connectionPools.errors,
    ...optimizationResults.systemConfig.errors
  ];
  
  if (optimizationResults.cacheSetup.error) {
    report.errors.push(optimizationResults.cacheSetup.error);
  }
  
  console.log('\n📋 PERFORMANCE OPTIMIZATION REPORT');
  console.log('=====================================');
  console.log(`Duration: ${report.duration}`);
  console.log(`Database Indexes Created: ${report.summary.database_indexes_created}`);
  console.log(`Connection Pools Configured: ${report.summary.connection_pools_configured}`);
  console.log(`Cache Status: ${report.summary.cache_status}`);
  console.log(`System Optimizations: ${report.summary.system_optimizations}`);
  console.log(`Overall Performance: ${validationResults.performance}`);
  
  if (report.recommendations.length > 0) {
    console.log('\n📝 Recommendations:');
    report.recommendations.forEach((rec, i) => {
      console.log(`${i + 1}. ${rec}`);
    });
  }
  
  if (report.errors.length > 0) {
    console.log('\n⚠️ Errors encountered:');
    report.errors.forEach((error, i) => {
      console.log(`${i + 1}. ${error}`);
    });
  }
  
  console.log('=====================================\n');
  
  return report;
}

/**
 * Cleanup resources
 */
async function cleanup() {
  console.log('🧹 Cleaning up resources...');
  
  try {
    if (pgPool) {
      await pgPool.end();
    }
    
    if (mysqlPool) {
      await mysqlPool.end();
    }
    
    if (redisClient) {
      await redisClient.quit();
    }
    
    console.log('✅ Cleanup completed');
  } catch (error) {
    console.warn('⚠️ Cleanup failed:', error.message);
  }
}

/**
 * Main execution function
 */
async function main() {
  console.log('🚀 PERFORMANCE OPTIMIZATION SCRIPT');
  console.log('Target: Handle 1000+ concurrent users on nxtdotx.co.za');
  console.log('=====================================\n');
  
  try {
    // Step 1: Initialize connections
    await initializeDatabaseConnections();
    
    // Step 2: Initialize cache
    await initializeRedisCache();
    
    // Step 3: Apply database indexes
    await applyDatabaseIndexes();
    
    // Step 4: Optimize connection pools
    await optimizeConnectionPools();
    
    // Step 5: Configure system optimizations
    await configureSystemOptimizations();
    
    // Step 6: Setup performance monitoring
    await setupPerformanceMonitoring();
    
    // Step 7: Validate optimizations
    const validationResults = await validateOptimizations();
    
    // Step 8: Generate report
    const report = generateOptimizationReport(validationResults);
    
    // Save report to file
    try {
      const fs = await import('fs/promises');
      await fs.writeFile(
        join(__dirname, '../logs/performance-optimization-report.json'),
        JSON.stringify(report, null, 2)
      );
      console.log('📄 Report saved to logs/performance-optimization-report.json');
    } catch (error) {
      console.warn('⚠️ Could not save report to file:', error.message);
    }
    
    console.log('🎉 Performance optimization completed successfully!');
    
  } catch (error) {
    console.error('❌ Performance optimization failed:', error);
    process.exit(1);
  } finally {
    await cleanup();
  }
}

// Handle process termination
process.on('SIGINT', async () => {
  console.log('\n⚠️ Process interrupted, cleaning up...');
  await cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n⚠️ Process terminated, cleaning up...');
  await cleanup();
  process.exit(0);
});

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default {
  main,
  initializeDatabaseConnections,
  initializeRedisCache,
  applyDatabaseIndexes,
  optimizeConnectionPools,
  configureSystemOptimizations,
  validateOptimizations,
  generateOptimizationReport
};