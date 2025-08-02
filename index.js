#!/usr/bin/env node

/**
 * FIGHTER JET BACKEND SERVER - PRODUCTION READY
 * NILEDB PostgreSQL + CORS for nxtdotx.co.za
 * Ultra-high performance with comprehensive error handling
 */

import { createServer } from 'http';
import { createClient } from 'redis';
import { cpus } from 'os';
import { performance } from 'perf_hooks';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Import NILEDB PostgreSQL configuration
import { 
  testNileConnection, 
  initializeNileDB, 
  nilePool, 
  insertDashboardMetric,
  getNileConnectionStatus 
} from './src/config/niledb.config.js';

// Import API Integration Services
import apiIntegrationService from './src/services/api-integration.service.js';
// Temporarily commented out due to configuration issues
// import woocommerceSyncService from './src/services/woocommerce-bidirectional-sync.service.js';
import paymentGatewayService from './src/services/payment-gateway.service.js';

// Production configuration
const PORT = process.env.PORT || 4000;
const NODE_ENV = process.env.NODE_ENV || 'production';
const CPU_COUNT = cpus().length;

// Performance tracking
let requestCount = 0;
let totalResponseTime = 0;
let startTime = Date.now();

// Redis client
let redisClient;

// CORS configuration for nxtdotx.co.za
const corsOptions = {
  origin: [
    'https://nxtdotx.co.za',
    'https://www.nxtdotx.co.za',
    'https://api.nxtdotx.co.za',
    'http://localhost:3000',
    'http://localhost:5173'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

/**
 * Initialize Redis Cache
 */
async function initializeRedisCache() {
  try {
    redisClient = createClient({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD || undefined
    });
    
    redisClient.on('error', (err) => {
      console.warn('Redis connection error (continuing without cache):', err.message);
    });
    
    await redisClient.connect();
    console.log('✅ Redis Cache connected');
  } catch (error) {
    console.warn('⚠️ Redis unavailable, running without cache:', error.message);
    redisClient = null;
  }
}

/**
 * Verify NILEDB PostgreSQL Health
 */
async function checkNileDBHealth() {
  try {
    const connectionTest = await testNileConnection();
    if (!connectionTest.success) {
      throw new Error(`NILEDB connection failed: ${connectionTest.error}`);
    }
    
    const connectionStatus = getNileConnectionStatus();
    console.log('✅ NILEDB PostgreSQL connection verified');
    console.log(`📊 Pool Stats - Total: ${connectionStatus.poolStats.totalCount}, Idle: ${connectionStatus.poolStats.idleCount}`);
    
    return connectionStatus;
  } catch (error) {
    console.error('❌ NILEDB health check failed:', error.message);
    throw error;
  }
}

/**
 * Routes Map
 */
const routes = new Map();

// Health check endpoint
routes.set('GET /health', async () => {
  try {
    const nileStatus = await testNileConnection();
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'ok',
        database: 'NILEDB_PostgreSQL',
        niledb_status: nileStatus.success,
        timestamp: new Date().toISOString(),
        server: 'FighterJet-NILEDB-Production'
      })
    };
  } catch (error) {
    return {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'error',
        error: NODE_ENV === 'development' ? error.message : 'Health check failed',
        timestamp: new Date().toISOString()
      })
    };
  }
});

// Performance metrics endpoint
routes.set('GET /', () => ({
  status: 200,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    service: 'NXT API',
    version: process.env.npm_package_version || '1.0.0',
    timestamp: new Date().toISOString()
  })
}));

// Performance metrics endpoint
routes.set('GET /metrics', () => {
  const uptime = Date.now() - startTime;
  const avgResponseTime = requestCount > 0 ? totalResponseTime / requestCount : 0;
  const rps = requestCount / (uptime / 1000);
  
  return {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      uptime,
      requests: requestCount,
      averageResponseTime: Number(avgResponseTime.toFixed(3)),
      requestsPerSecond: Number(rps.toFixed(2)),
      database: 'NILEDB_PostgreSQL',
      cors_enabled: corsOptions.origin,
      environment: NODE_ENV,
      timestamp: new Date().toISOString()
    })
  };
});

// Dashboard health endpoint
routes.set('GET /api/dashboard/health', async () => {
  try {
    const nileStatus = await testNileConnection();
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        service: 'dashboard',
        database: 'NILEDB_PostgreSQL',
        niledb_status: nileStatus.success,
        timestamp: new Date().toISOString()
      })
    };
  } catch (error) {
    return {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: 'Health check failed',
        message: error.message,
        timestamp: new Date().toISOString()
      })
    };
  }
});

// Suppliers endpoint - NILEDB PostgreSQL
routes.set('GET /api/suppliers', async () => {
  try {
    if (!nilePool) {
      return {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          success: false,
          error: 'NILEDB PostgreSQL not available',
          timestamp: new Date().toISOString()
        })
      };
    }
    
    const client = await nilePool.connect();
    
    try {
      const result = await client.query(
        'SELECT * FROM suppliers WHERE is_active = true ORDER BY name'
      );
      
      // Log metric
      await insertDashboardMetric('suppliers_fetched', result.rows.length, 'gauge');
      
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          success: true,
          data: result.rows,
          count: result.rows.length,
          database: 'NILEDB_PostgreSQL',
          timestamp: new Date().toISOString()
        })
      };
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Suppliers query error:', error);
    
    try {
      await insertDashboardMetric('api_error', 1, 'counter', { 
        endpoint: '/api/suppliers',
        error: error.message 
      });
    } catch (metricsError) {
      console.warn('Failed to log error metric:', metricsError.message);
    }
    
    return {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        success: false,
        error: 'Failed to fetch suppliers', 
        message: NODE_ENV === 'development' ? error.message : 'Internal server error',
        timestamp: new Date().toISOString()
      })
    };
  }
});

// API Integration Status
routes.set('GET /api/integrations/status', async () => {
  try {
    const status = apiIntegrationService.getIntegrationStatus();
    const metrics = await apiIntegrationService.getServiceMetrics();
    
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        data: { integrations: status, metrics },
        database: 'NILEDB_PostgreSQL',
        timestamp: new Date().toISOString()
      })
    };
  } catch (error) {
    console.error('Integration status error:', error);
    return {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        success: false, 
        error: NODE_ENV === 'development' ? error.message : 'Integration status unavailable',
        timestamp: new Date().toISOString()
      })
    };
  }
});

/**
 * HTTP Server with CORS and Error Handling
 */
const server = createServer(async (req, res) => {
  const requestStart = performance.now();
  requestCount++;
  
  try {
    const method = req.method;
    const url = req.url.split('?')[0];
    const routeKey = `${method} ${url}`;
    
    // CORS headers for nxtdotx.co.za
    const origin = req.headers.origin;
    if (corsOptions.origin.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', corsOptions.methods.join(', '));
    res.setHeader('Access-Control-Allow-Headers', corsOptions.allowedHeaders.join(', '));
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    // Security headers
    res.setHeader('X-Powered-By', 'FighterJet-NILEDB');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    
    // Handle preflight requests
    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    
    // Route handling
    const handler = routes.get(routeKey);
    
    if (handler) {
      const result = await handler(req, res);
      
      // Set response headers
      for (const [key, value] of Object.entries(result.headers || {})) {
        res.setHeader(key, value);
      }
      
      res.writeHead(result.status || 200);
      res.end(result.body || '');
    } else {
      // 404 - Not Found
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(404);
      res.end(JSON.stringify({
        success: false,
        error: 'Not Found',
        code: 404,
        database: 'NILEDB_PostgreSQL',
        timestamp: new Date().toISOString()
      }));
    }
    
  } catch (error) {
    console.error('Request error:', error);
    
    // Log error metric
    try {
      await insertDashboardMetric('server_error', 1, 'counter', { 
        method: req.method,
        url: req.url,
        error: error.message 
      });
    } catch (metricsError) {
      console.warn('Failed to log error metric:', metricsError.message);
    }
    
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(500);
    res.end(JSON.stringify({
      success: false,
      error: 'Internal Server Error',
      code: 500,
      message: NODE_ENV === 'development' ? error.message : 'Internal server error',
      database: 'NILEDB_PostgreSQL',
      timestamp: new Date().toISOString()
    }));
  } finally {
    // Track performance
    const responseTime = performance.now() - requestStart;
    totalResponseTime += responseTime;
    
    // Log slow requests
    if (responseTime > 5.0) {
      console.warn(`⚠️ Slow request: ${req.method} ${req.url} - ${responseTime.toFixed(3)}ms`);
    }
  }
});

/**
 * Graceful Shutdown
 */
async function gracefulShutdown(signal) {
  console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
  
  try {
    server.close(async () => {
      console.log('✅ HTTP server closed');
      
      try {
        if (nilePool) {
          await nilePool.end();
          console.log('✅ NILEDB PostgreSQL pool closed');
        }
        
        if (redisClient) {
          await redisClient.quit();
          console.log('✅ Redis connection closed');
        }
        
        console.log('🚀 Graceful shutdown completed');
        process.exit(0);
      } catch (error) {
        console.error('❌ Error during shutdown:', error);
        process.exit(1);
      }
    });
    
    // Force shutdown after 10 seconds
    setTimeout(() => {
      console.error('❌ Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
    
  } catch (error) {
    console.error('❌ Shutdown error:', error);
    process.exit(1);
  }
}

/**
 * Server Initialization
 */
async function startServer() {
  const initStart = performance.now();
  
  try {
    console.log('🚀 Initializing Fighter Jet Backend Server - Production Ready');
    console.log(`💾 CPUs: ${CPU_COUNT}`);
    console.log(`🌐 CORS: ${corsOptions.origin.join(', ')}`);
    console.log(`📊 Environment: ${NODE_ENV}`);
    
    // Initialize all systems
    await Promise.all([
      checkNileDBHealth(),
      initializeRedisCache(),
      initializeNileDB()
    ]);

    // Initialize API Integration Services
    console.log('🔗 Initializing API Integration Services...');
    await Promise.all([
      apiIntegrationService.initializeIntegrations().catch(err => {
        console.warn('⚠️ API Integration Service failed:', err.message);
      }),
      // Temporarily commented out due to configuration issues
      // woocommerceSyncService.initialize().catch(err => {
      //   console.warn('⚠️ WooCommerce Sync Service failed:', err.message);
      // }),
      paymentGatewayService.initialize().catch(err => {
        console.warn('⚠️ Payment Gateway Service failed:', err.message);
      })
    ]);
    
    // Start server
    server.listen(PORT, () => {
      const initTime = performance.now() - initStart;
      console.log(`\n🚀 FIGHTER JET SERVER ACTIVE - PRODUCTION READY`);
      console.log(`📡 Port: ${PORT}`);
      console.log(`⚡ Startup: ${initTime.toFixed(3)}ms`);
      console.log(`🗄️ NILEDB PostgreSQL: Connected`);
      console.log(`⚡ Redis: ${redisClient ? 'Connected' : 'Unavailable'}`);
      console.log(`🌐 CORS: Enabled for nxtdotx.co.za`);
      console.log(`\n📊 Endpoints:`);
      console.log(`   Health: http://localhost:${PORT}/health`);
      console.log(`   Metrics: http://localhost:${PORT}/metrics`);
      console.log(`   Suppliers: http://localhost:${PORT}/api/suppliers`);
      console.log(`   Integrations: http://localhost:${PORT}/api/integrations/status`);
      console.log(`\n🛡️ Production Ready with NILEDB PostgreSQL!`);
      
      // Log startup metrics
      insertDashboardMetric('server_startup', initTime, 'gauge', {
        port: PORT,
        environment: NODE_ENV,
        database: 'NILEDB_PostgreSQL'
      }).catch(err => console.warn('Failed to log startup metric:', err.message));
    });
    
    // Setup signal handlers
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2'));
    
    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      console.error('❌ Uncaught Exception:', error);
      gracefulShutdown('UNCAUGHT_EXCEPTION');
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      console.error('❌ Unhandled Rejection:', reason, 'at:', promise);
      gracefulShutdown('UNHANDLED_REJECTION');
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();