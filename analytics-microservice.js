#!/usr/bin/env node

/**
 * ANALYTICS MICROSERVICE - SEPARATED FROM MAIN BACKEND
 * Handles all analytics processing without impacting main server performance
 * Runs on separate port to maintain fighter jet backend speed
 */

import { createServer } from 'http';
import { createPool } from 'mysql2/promise';
import { createClient } from 'redis';
import { performance } from 'perf_hooks';
import dotenv from 'dotenv';

dotenv.config();

// Analytics service configuration
const ANALYTICS_PORT = process.env.ANALYTICS_PORT || 4001;
const MAIN_BACKEND_PORT = process.env.PORT || 4000;

// Separate database pool for analytics
let analyticsDbPool;
let analyticsRedisClient;

// Analytics data storage
let analyticsMetrics = {
  requests: 0,
  errors: 0,
  responseTimeTotal: 0,
  startTime: Date.now(),
  endpoints: new Map()
};

/**
 * Initialize Analytics Database Pool
 */
async function initializeAnalyticsDB() {
  const poolConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'horizon',
    
    // Analytics-optimized settings
    connectionLimit: 10, // Fewer connections for analytics
    acquireTimeout: 5000,
    timeout: 10000,
    reconnect: true
  };

  analyticsDbPool = createPool(poolConfig);
  console.log('📊 Analytics DB Pool initialized');
}

/**
 * Initialize Analytics Redis Cache
 */
async function initializeAnalyticsCache() {
  try {
    analyticsRedisClient = createClient({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      keyPrefix: 'analytics:'
    });
    
    await analyticsRedisClient.connect();
    console.log('📊 Analytics Redis Cache connected');
  } catch (error) {
    console.warn('⚠️ Analytics Redis unavailable:', error.message);
    analyticsRedisClient = null;
  }
}

/**
 * Analytics Route Handlers
 */
const analyticsRoutes = new Map();

// Real-time analytics dashboard
analyticsRoutes.set('GET /analytics/dashboard', async () => {
  const uptime = Date.now() - analyticsMetrics.startTime;
  const avgResponseTime = analyticsMetrics.requests > 0 
    ? analyticsMetrics.responseTimeTotal / analyticsMetrics.requests 
    : 0;

  return {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      uptime,
      totalRequests: analyticsMetrics.requests,
      totalErrors: analyticsMetrics.errors,
      averageResponseTime: Number(avgResponseTime.toFixed(3)),
      errorRate: analyticsMetrics.requests > 0 
        ? Number((analyticsMetrics.errors / analyticsMetrics.requests * 100).toFixed(2))
        : 0,
      endpoints: Array.from(analyticsMetrics.endpoints.entries()).map(([endpoint, data]) => ({
        endpoint,
        requests: data.requests,
        averageTime: data.totalTime / data.requests,
        errors: data.errors
      }))
    })
  };
});

// System performance metrics
analyticsRoutes.set('GET /analytics/performance', async () => {
  try {
    // Get main backend metrics
    const mainBackendResponse = await fetch(`http://localhost:${MAIN_BACKEND_PORT}/metrics`);
    const mainMetrics = await mainBackendResponse.json();
    
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mainBackend: mainMetrics,
        analyticsService: {
          uptime: Date.now() - analyticsMetrics.startTime,
          requests: analyticsMetrics.requests,
          errors: analyticsMetrics.errors,
          memoryUsage: process.memoryUsage(),
          cpuUsage: process.cpuUsage()
        }
      })
    };
  } catch (error) {
    return {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to fetch performance metrics' })
    };
  }
});

// Database analytics
analyticsRoutes.set('GET /analytics/database', async () => {
  try {
    if (!analyticsDbPool) {
      return {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Database not available' })
      };
    }

    const [supplierCount] = await analyticsDbPool.execute('SELECT COUNT(*) as count FROM suppliers');
    const [customerCount] = await analyticsDbPool.execute('SELECT COUNT(*) as count FROM customers');
    
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        suppliers: supplierCount[0]?.count || 0,
        customers: customerCount[0]?.count || 0,
        timestamp: Date.now()
      })
    };
  } catch (error) {
    return {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Database query failed', message: error.message })
    };
  }
});

// Health check for analytics service
analyticsRoutes.set('GET /analytics/health', () => {
  return {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'healthy',
      service: 'analytics-microservice',
      timestamp: Date.now(),
      uptime: Date.now() - analyticsMetrics.startTime
    })
  };
});

/**
 * Analytics HTTP Server
 */
const analyticsServer = createServer(async (req, res) => {
  const requestStart = performance.now();
  analyticsMetrics.requests++;
  
  try {
    const method = req.method;
    const url = req.url.split('?')[0];
    const routeKey = `${method} ${url}`;
    
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('X-Service', 'Analytics-Microservice');
    
    // Handle preflight
    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    
    // Track endpoint usage
    if (!analyticsMetrics.endpoints.has(routeKey)) {
      analyticsMetrics.endpoints.set(routeKey, {
        requests: 0,
        totalTime: 0,
        errors: 0
      });
    }
    
    const endpointData = analyticsMetrics.endpoints.get(routeKey);
    endpointData.requests++;
    
    // Route handling
    const handler = analyticsRoutes.get(routeKey);
    
    if (handler) {
      const result = await handler(req, res);
      
      // Set response headers
      for (const [key, value] of Object.entries(result.headers || {})) {
        res.setHeader(key, value);
      }
      
      res.writeHead(result.status || 200);
      res.end(result.body || '');
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Analytics endpoint not found' }));
      endpointData.errors++;
      analyticsMetrics.errors++;
    }
    
    // Track timing
    const responseTime = performance.now() - requestStart;
    analyticsMetrics.responseTimeTotal += responseTime;
    endpointData.totalTime += responseTime;
    
  } catch (error) {
    console.error('Analytics service error:', error);
    analyticsMetrics.errors++;
    
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(500);
    res.end(JSON.stringify({ error: 'Analytics service error' }));
  }
});

/**
 * Graceful shutdown for analytics service
 */
async function shutdownAnalyticsService(signal) {
  console.log(`\n📊 Analytics Service received ${signal}. Shutting down...`);
  
  try {
    analyticsServer.close(async () => {
      console.log('✅ Analytics HTTP server closed');
      
      if (analyticsDbPool) {
        await analyticsDbPool.end();
        console.log('✅ Analytics DB pool closed');
      }
      
      if (analyticsRedisClient) {
        await analyticsRedisClient.quit();
        console.log('✅ Analytics Redis closed');
      }
      
      console.log('📊 Analytics Service shutdown complete');
      process.exit(0);
    });
    
    setTimeout(() => {
      console.error('❌ Analytics Service forced shutdown');
      process.exit(1);
    }, 5000);
    
  } catch (error) {
    console.error('❌ Analytics shutdown error:', error);
    process.exit(1);
  }
}

/**
 * Start Analytics Microservice
 */
async function startAnalyticsService() {
  try {
    console.log('📊 Starting Analytics Microservice...');
    
    // Initialize analytics systems
    await Promise.all([
      initializeAnalyticsDB(),
      initializeAnalyticsCache()
    ]);
    
    // Start analytics server
    analyticsServer.listen(ANALYTICS_PORT, () => {
      console.log(`\n📊 ANALYTICS MICROSERVICE ACTIVE`);
      console.log(`📡 Port: ${ANALYTICS_PORT}`);
      console.log(`🔗 Main Backend: http://localhost:${MAIN_BACKEND_PORT}`);
      console.log(`📈 Dashboard: http://localhost:${ANALYTICS_PORT}/analytics/dashboard`);
      console.log(`⚡ Performance: http://localhost:${ANALYTICS_PORT}/analytics/performance`);
      console.log(`🗄️ Database: http://localhost:${ANALYTICS_PORT}/analytics/database`);
      console.log(`💚 Health: http://localhost:${ANALYTICS_PORT}/analytics/health`);
      console.log(`\n📊 Analytics Service Ready!`);
    });
    
    // Setup shutdown handlers
    process.on('SIGTERM', () => shutdownAnalyticsService('SIGTERM'));
    process.on('SIGINT', () => shutdownAnalyticsService('SIGINT'));
    process.on('SIGUSR2', () => shutdownAnalyticsService('SIGUSR2'));
    
  } catch (error) {
    console.error('❌ Failed to start Analytics Service:', error);
    process.exit(1);
  }
}

// Launch Analytics Microservice
startAnalyticsService();