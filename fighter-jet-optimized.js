#!/usr/bin/env node

/**
 * FIGHTER JET OPTIMIZED SERVER - PRODUCTION READY
 * Ultra-high performance server designed for 1000+ concurrent users
 * Target: <500ms response time under maximum load
 * Enhanced with comprehensive optimization and monitoring
 */

import { createServer } from 'http';
import { Worker } from 'worker_threads';
import { cpus } from 'os';
import { performance } from 'perf_hooks';
import { promisify } from 'util';
import dotenv from 'dotenv';
import cluster from 'cluster';

// Import optimization configurations
import {
  initializeRedisClient,
  queryCache,
  performanceMonitor,
  performanceMiddleware,
  cacheMiddleware,
  advancedRateLimitMiddleware,
  compressionConfig,
  connectionPoolConfig,
  databaseIndexes
} from './src/config/performance-optimization.config.js';

// Load environment variables
dotenv.config();

// Ultra-fast constants
const PORT = process.env.PORT || 4000;
const CLUSTER_MODE = process.env.CLUSTER_MODE === 'true';
const MAX_WORKERS = parseInt(process.env.MAX_WORKERS) || Math.min(cpus().length, 8);
const NODE_ENV = process.env.NODE_ENV || 'production';

// Global performance tracking
let serverMetrics = {
  startTime: Date.now(),
  requestCount: 0,
  totalResponseTime: 0,
  concurrentConnections: 0,
  peakConcurrentConnections: 0,
  errorCount: 0,
  cacheHitCount: 0,
  cacheMissCount: 0
};

// Connection pools
let dbPool = null;
let redisClient = null;
let workerPool = [];

/**
 * ULTRA-OPTIMIZED DATABASE CONNECTION POOL
 */
async function initializeOptimizedDatabase() {
  console.log('🚀 Initializing optimized database connections...');
  
  try {
    // Import database configuration based on environment
    if (process.env.DATABASE_URL) {
      // PostgreSQL (Primary)
      const { Pool } = await import('pg');
      const { drizzle } = await import('drizzle-orm/node-postgres');
      
      dbPool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ...connectionPoolConfig.postgresql,
        
        // Production optimizations
        ssl: NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
        
        // Connection lifecycle management
        keepAlive: true,
        keepAliveInitialDelayMillis: 10000,
        
        // Performance tuning
        statement_timeout: 30000,
        query_timeout: 25000,
        application_name: 'nxtdotx_fighter_jet'
      });
      
      // Test connection and warm up pool
      const client = await dbPool.connect();
      await client.query('SELECT NOW(), version()');
      client.release();
      
      // Pre-warm additional connections
      const warmupPromises = [];
      for (let i = 0; i < 5; i++) {
        warmupPromises.push(
          dbPool.connect().then(client => {
            client.query('SELECT 1').then(() => client.release());
          })
        );
      }
      await Promise.all(warmupPromises);
      
      console.log('✅ PostgreSQL pool initialized with optimized settings');
      
    } else if (process.env.DB_HOST) {
      // MySQL (Legacy support)
      const mysql = await import('mysql2/promise');
      
      dbPool = mysql.createPool({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        ...connectionPoolConfig.mysql,
        
        // Performance flags
        flags: '+COMPRESS+PROTOCOL_41+TRANSACTIONS+RESERVED+SECURE_CONNECTION',
        
        // Connection optimization
        acquireTimeout: 60000,
        timeout: 60000,
        reconnect: true,
        idleTimeout: 300000
      });
      
      // Test and warm up
      await dbPool.execute('SELECT 1');
      console.log('✅ MySQL pool initialized with optimized settings');
    }
    
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    process.exit(1);
  }
}

/**
 * REDIS CACHE INITIALIZATION
 */
async function initializeCache() {
  console.log('🚀 Initializing Redis cache...');
  
  try {
    redisClient = await initializeRedisClient();
    if (redisClient) {
      // Test Redis connection
      await redisClient.ping();
      
      // Pre-warm cache with system configuration
      const systemConfig = {
        initialized: true,
        timestamp: Date.now(),
        version: process.env.npm_package_version || '1.0.0'
      };
      
      await redisClient.setEx('system:config', 3600, JSON.stringify(systemConfig));
      console.log('✅ Redis cache initialized and pre-warmed');
    }
  } catch (error) {
    console.warn('⚠️ Redis cache initialization failed, continuing without cache:', error.message);
    redisClient = null;
  }
}

/**
 * WORKER THREAD POOL FOR CPU-INTENSIVE TASKS
 */
function initializeWorkerPool() {
  const workerCount = Math.min(cpus().length, 4);
  console.log(`🚀 Initializing ${workerCount} worker threads...`);
  
  for (let i = 0; i < workerCount; i++) {
    try {
      const worker = new Worker(`
        const { parentPort } = require('worker_threads');
        
        parentPort.on('message', async (data) => {
          try {
            const { type, payload, id } = data;
            let result;
            
            switch (type) {
              case 'json_parse':
                result = JSON.parse(payload);
                break;
              case 'json_stringify':
                result = JSON.stringify(payload);
                break;
              case 'calculation':
                result = eval(payload); // Be careful with this in production
                break;
              case 'data_processing':
                result = payload.map(item => ({ ...item, processed: true }));
                break;
              default:
                throw new Error('Unknown task type');
            }
            
            parentPort.postMessage({ id, result, error: null });
          } catch (error) {
            parentPort.postMessage({ id, result: null, error: error.message });
          }
        });
      `, { eval: true });
      
      workerPool.push(worker);
    } catch (error) {
      console.warn('⚠️ Worker thread creation failed:', error.message);
    }
  }
  
  console.log(`✅ Worker pool initialized with ${workerPool.length} workers`);
}

/**
 * EXECUTE TASK IN WORKER THREAD
 */
function executeInWorker(type, payload) {
  return new Promise((resolve, reject) => {
    if (workerPool.length === 0) {
      // Fallback to main thread
      try {
        let result;
        switch (type) {
          case 'json_parse':
            result = JSON.parse(payload);
            break;
          case 'json_stringify':
            result = JSON.stringify(payload);
            break;
          default:
            result = payload;
        }
        resolve(result);
      } catch (error) {
        reject(error);
      }
      return;
    }
    
    const worker = workerPool[Math.floor(Math.random() * workerPool.length)];
    const id = Math.random().toString(36).substr(2, 9);
    
    const timeout = setTimeout(() => {
      reject(new Error('Worker timeout'));
    }, 5000);
    
    const messageHandler = (data) => {
      if (data.id === id) {
        clearTimeout(timeout);
        worker.off('message', messageHandler);
        
        if (data.error) {
          reject(new Error(data.error));
        } else {
          resolve(data.result);
        }
      }
    };
    
    worker.on('message', messageHandler);
    worker.postMessage({ type, payload, id });
  });
}

/**
 * ULTRA-FAST ROUTING SYSTEM
 * Direct map-based routing with zero overhead
 */
const routes = new Map();

// Health check endpoint - ultra-fast
routes.set('GET:/health', async (req, res) => {
  const healthData = {
    status: 'healthy',
    timestamp: Date.now(),
    uptime: Date.now() - serverMetrics.startTime,
    connections: serverMetrics.concurrentConnections,
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB'
  };
  
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(healthData));
});

// Performance metrics endpoint
routes.set('GET:/metrics', async (req, res) => {
  const metrics = {
    ...serverMetrics,
    performance: performanceMonitor.getMetrics(),
    cache: queryCache.getStats(),
    database: dbPool ? {
      totalCount: dbPool.totalCount || dbPool._allConnections?.length || 0,
      idleCount: dbPool.idleCount || dbPool._freeConnections?.length || 0,
      waitingCount: dbPool.waitingCount || dbPool._connectionQueue?.length || 0
    } : null,
    system: {
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      platform: process.platform,
      nodeVersion: process.version
    }
  };
  
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(metrics, null, 2));
});

// Fast database query endpoint
routes.set('GET:/api/fast-query', async (req, res) => {
  try {
    const startTime = performance.now();
    
    // Try cache first
    const cacheKey = 'fast-query:system-status';
    let result = await queryCache.get(cacheKey);
    
    if (!result) {
      // Execute database query
      if (dbPool) {
        if (process.env.DATABASE_URL) {
          // PostgreSQL
          const client = await dbPool.connect();
          const queryResult = await client.query('SELECT NOW() as current_time, version() as db_version');
          client.release();
          result = queryResult.rows[0];
        } else {
          // MySQL
          const [rows] = await dbPool.execute('SELECT NOW() as current_time, VERSION() as db_version');
          result = rows[0];
        }
        
        // Cache result for 60 seconds
        await queryCache.set(cacheKey, result, 60);
        serverMetrics.cacheMissCount++;
      } else {
        result = { current_time: new Date(), db_version: 'No database configured' };
      }
    } else {
      serverMetrics.cacheHitCount++;
    }
    
    const responseTime = performance.now() - startTime;
    
    res.writeHead(200, { 
      'Content-Type': 'application/json',
      'X-Response-Time': `${responseTime.toFixed(2)}ms`,
      'X-Cache': result === await queryCache.get(cacheKey) ? 'HIT' : 'MISS'
    });
    
    res.end(JSON.stringify({
      ...result,
      response_time_ms: responseTime,
      cache_hit: result === await queryCache.get(cacheKey)
    }));
    
  } catch (error) {
    console.error('Fast query error:', error);
    serverMetrics.errorCount++;
    
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Database query failed', message: error.message }));
  }
});

// Cached data endpoint
routes.set('GET:/api/cached-data', async (req, res) => {
  try {
    const startTime = performance.now();
    const cacheKey = 'api:cached-data';
    
    let data = await queryCache.get(cacheKey);
    let fromCache = true;
    
    if (!data) {
      // Generate data (simulate expensive operation)
      data = {
        timestamp: new Date().toISOString(),
        random_data: Array.from({length: 100}, () => Math.random()),
        system_info: {
          uptime: Date.now() - serverMetrics.startTime,
          requests: serverMetrics.requestCount,
          connections: serverMetrics.concurrentConnections
        }
      };
      
      // Use worker thread for heavy processing
      try {
        data.processed_data = await executeInWorker('data_processing', data.random_data);
      } catch (workerError) {
        console.warn('Worker processing failed, using main thread:', workerError.message);
        data.processed_data = data.random_data.map(item => ({ value: item, processed: true }));
      }
      
      await queryCache.set(cacheKey, data, 300); // Cache for 5 minutes
      fromCache = false;
      serverMetrics.cacheMissCount++;
    } else {
      serverMetrics.cacheHitCount++;
    }
    
    const responseTime = performance.now() - startTime;
    
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'X-Response-Time': `${responseTime.toFixed(2)}ms`,
      'X-Cache': fromCache ? 'HIT' : 'MISS'
    });
    
    res.end(JSON.stringify({
      ...data,
      response_time_ms: responseTime,
      from_cache: fromCache
    }));
    
  } catch (error) {
    console.error('Cached data error:', error);
    serverMetrics.errorCount++;
    
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to retrieve cached data' }));
  }
});

// Load test endpoint
routes.set('GET:/api/load-test', async (req, res) => {
  const startTime = performance.now();
  
  // Simulate various workloads
  const operations = [
    () => Promise.resolve({ operation: 'memory', result: 'success' }),
    () => new Promise(resolve => setTimeout(() => resolve({ operation: 'timeout', result: 'success' }), 1)),
    () => queryCache.get('load-test') || queryCache.set('load-test', { test: true }, 10)
  ];
  
  try {
    const results = await Promise.all(operations.map(op => op()));
    const responseTime = performance.now() - startTime;
    
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'X-Response-Time': `${responseTime.toFixed(2)}ms`
    });
    
    res.end(JSON.stringify({
      results,
      response_time_ms: responseTime,
      concurrent_connections: serverMetrics.concurrentConnections
    }));
  } catch (error) {
    const responseTime = performance.now() - startTime;
    serverMetrics.errorCount++;
    
    res.writeHead(500, {
      'Content-Type': 'application/json',
      'X-Response-Time': `${responseTime.toFixed(2)}ms`
    });
    
    res.end(JSON.stringify({
      error: error.message,
      response_time_ms: responseTime
    }));
  }
});

/**
 * ULTRA-FAST REQUEST HANDLER
 * Zero middleware overhead, direct routing
 */
async function handleRequest(req, res) {
  const startTime = performance.now();
  serverMetrics.requestCount++;
  serverMetrics.concurrentConnections++;
  
  if (serverMetrics.concurrentConnections > serverMetrics.peakConcurrentConnections) {
    serverMetrics.peakConcurrentConnections = serverMetrics.concurrentConnections;
  }
  
  // Set CORS headers for all requests
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    serverMetrics.concurrentConnections--;
    return;
  }
  
  const routeKey = `${req.method}:${req.url.split('?')[0]}`;
  const handler = routes.get(routeKey);
  
  try {
    if (handler) {
      await handler(req, res);
    } else {
      // 404 handler
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        error: 'Not Found', 
        path: req.url,
        method: req.method 
      }));
    }
  } catch (error) {
    console.error('Request handler error:', error);
    serverMetrics.errorCount++;
    
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal Server Error' }));
    }
  } finally {
    const responseTime = performance.now() - startTime;
    serverMetrics.totalResponseTime += responseTime;
    serverMetrics.concurrentConnections--;
    
    // Update performance monitor
    performanceMonitor.recordRequest(responseTime, res.statusCode < 400);
  }
}

/**
 * SERVER INITIALIZATION
 */
async function initializeServer() {
  console.log('🚀 Starting Fighter Jet Optimized Server...');
  console.log(`📊 Environment: ${NODE_ENV}`);
  console.log(`🖥️ CPU Cores: ${cpus().length}`);
  console.log(`👥 Max Workers: ${MAX_WORKERS}`);
  console.log(`🐥 Cluster Mode: ${CLUSTER_MODE}`);
  
  try {
    // Initialize all components
    await initializeOptimizedDatabase();
    await initializeCache();
    initializeWorkerPool();
    
    // Create HTTP server with optimizations
    const server = createServer(handleRequest);
    
    // Server optimization settings
    server.keepAliveTimeout = 120000; // 2 minutes
    server.headersTimeout = 125000; // Slightly longer than keepAliveTimeout
    server.maxRequestsPerSocket = 1000;
    server.timeout = 300000; // 5 minutes
    
    // Connection management
    server.on('connection', (socket) => {
      socket.setNoDelay(true);
      socket.setKeepAlive(true, 30000);
    });
    
    // Error handling
    server.on('error', (error) => {
      console.error('❌ Server error:', error);
      serverMetrics.errorCount++;
    });
    
    // Graceful shutdown handling
    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);
    
    // Start server
    server.listen(PORT, () => {
      console.log(`✅ Fighter Jet Server listening on port ${PORT}`);
      console.log(`🎯 Target: <500ms response time for 1000+ concurrent users`);
      console.log(`📡 Health check: http://localhost:${PORT}/health`);
      console.log(`📊 Metrics: http://localhost:${PORT}/metrics`);
      console.log('🚀 Server ready for maximum performance!');
    });
    
    // Performance monitoring
    setInterval(() => {
      const avgResponseTime = serverMetrics.totalResponseTime / serverMetrics.requestCount || 0;
      const cacheHitRate = (serverMetrics.cacheHitCount / (serverMetrics.cacheHitCount + serverMetrics.cacheMissCount)) * 100 || 0;
      
      console.log(`📊 Performance: ${serverMetrics.requestCount} requests, ${avgResponseTime.toFixed(2)}ms avg, ${cacheHitRate.toFixed(1)}% cache hit rate, ${serverMetrics.concurrentConnections} active connections`);
    }, 30000);
    
  } catch (error) {
    console.error('❌ Server initialization failed:', error);
    process.exit(1);
  }
}

/**
 * GRACEFUL SHUTDOWN
 */
async function gracefulShutdown(signal) {
  console.log(`\n🛑 Received ${signal}, starting graceful shutdown...`);
  
  try {
    // Close database connections
    if (dbPool) {
      await dbPool.end();
      console.log('✅ Database connections closed');
    }
    
    // Close Redis connection
    if (redisClient) {
      await redisClient.quit();
      console.log('✅ Redis connection closed');
    }
    
    // Terminate worker threads
    workerPool.forEach(worker => worker.terminate());
    console.log('✅ Worker threads terminated');
    
    console.log('✅ Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
}

/**
 * CLUSTER MODE OR SINGLE PROCESS
 */
if (CLUSTER_MODE && cluster.isPrimary) {
  console.log(`🐥 Starting cluster with ${MAX_WORKERS} workers`);
  
  // Fork workers
  for (let i = 0; i < MAX_WORKERS; i++) {
    cluster.fork();
  }
  
  // Handle worker exits
  cluster.on('exit', (worker, code, signal) => {
    console.log(`⚠️ Worker ${worker.process.pid} died, restarting...`);
    setTimeout(() => cluster.fork(), 1000);
  });
  
} else {
  // Single process or worker process
  initializeServer();
}

export default {
  serverMetrics,
  initializeServer,
  gracefulShutdown
};