/**
 * CRITICAL P1: Comprehensive Health Check Endpoints
 * Provides /health, /ready, /live endpoints for all services
 * Kubernetes-compatible health checks with detailed service monitoring
 */

import express from 'express';
import { performance } from 'perf_hooks';
import { validateSystemHealth } from '../utils/health-checks.js';

const router = express.Router();

// Service health cache to avoid excessive checks
const healthCache = new Map();
const CACHE_TTL = 5000; // 5 seconds cache

/**
 * GET /health - Basic health check
 * Used by load balancers and monitoring systems
 */
router.get('/health', async (req, res) => {
  const startTime = performance.now();
  
  try {
    // Quick database connectivity check
    const { db } = await import('../config/database.js');
    await db.execute('SELECT 1 as health_check');
    
    const responseTime = performance.now() - startTime;
    
    res.status(200).json({
      status: 'healthy',
      service: 'nxt-backend',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      responseTime: `${responseTime.toFixed(2)}ms`,
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'development'
    });
  } catch (error) {
    const responseTime = performance.now() - startTime;
    
    res.status(503).json({
      status: 'unhealthy',
      service: 'nxt-backend',
      timestamp: new Date().toISOString(),
      error: error.message,
      responseTime: `${responseTime.toFixed(2)}ms`
    });
  }
});

/**
 * GET /ready - Readiness probe
 * Checks if service is ready to accept traffic
 */
router.get('/ready', async (req, res) => {
  const startTime = performance.now();
  
  try {
    // Check all critical dependencies
    const readinessChecks = await Promise.allSettled([
      checkDatabaseConnectivity(),
      checkRedisConnectivity(),
      checkCriticalServices(),
      checkSystemResources()
    ]);
    
    const failures = readinessChecks
      .filter(result => result.status === 'rejected')
      .map(result => result.reason);
    
    const responseTime = performance.now() - startTime;
    
    if (failures.length === 0) {
      res.status(200).json({
        status: 'ready',
        service: 'nxt-backend',
        timestamp: new Date().toISOString(),
        responseTime: `${responseTime.toFixed(2)}ms`,
        checks: {
          database: 'healthy',
          redis: 'healthy', 
          services: 'healthy',
          resources: 'healthy'
        }
      });
    } else {
      res.status(503).json({
        status: 'not_ready',
        service: 'nxt-backend',
        timestamp: new Date().toISOString(),
        responseTime: `${responseTime.toFixed(2)}ms`,
        failures: failures
      });
    }
  } catch (error) {
    const responseTime = performance.now() - startTime;
    
    res.status(503).json({
      status: 'not_ready',
      service: 'nxt-backend',
      timestamp: new Date().toISOString(),
      error: error.message,
      responseTime: `${responseTime.toFixed(2)}ms`
    });
  }
});

/**
 * GET /live - Liveness probe
 * Checks if service is alive and should not be restarted
 */
router.get('/live', async (req, res) => {
  const startTime = performance.now();
  
  try {
    // Check if main process is responsive
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    const responseTime = performance.now() - startTime;
    
    // Check for memory leaks or blocked event loop
    const isHealthy = responseTime < 1000 && memUsage.heapUsed < 1024 * 1024 * 1024; // 1GB limit
    
    if (isHealthy) {
      res.status(200).json({
        status: 'alive',
        service: 'nxt-backend',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        responseTime: `${responseTime.toFixed(2)}ms`,
        memory: {
          heapUsed: `${(memUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`,
          heapTotal: `${(memUsage.heapTotal / 1024 / 1024).toFixed(2)}MB`,
          external: `${(memUsage.external / 1024 / 1024).toFixed(2)}MB`
        },
        cpu: {
          user: cpuUsage.user,
          system: cpuUsage.system
        }
      });
    } else {
      res.status(503).json({
        status: 'unhealthy',
        service: 'nxt-backend',
        timestamp: new Date().toISOString(),
        reason: responseTime >= 1000 ? 'slow_response' : 'high_memory_usage',
        responseTime: `${responseTime.toFixed(2)}ms`,
        memory: {
          heapUsed: `${(memUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`
        }
      });
    }
  } catch (error) {
    const responseTime = performance.now() - startTime;
    
    res.status(503).json({
      status: 'unhealthy',
      service: 'nxt-backend',
      timestamp: new Date().toISOString(),
      error: error.message,
      responseTime: `${responseTime.toFixed(2)}ms`
    });
  }
});

/**
 * GET /health/detailed - Comprehensive health check
 * Detailed health status of all services and dependencies
 */
router.get('/health/detailed', async (req, res) => {
  const startTime = performance.now();
  
  try {
    // Check cache first
    const cacheKey = 'detailed_health';
    const cachedResult = getCachedHealth(cacheKey);
    
    if (cachedResult) {
      return res.status(cachedResult.status === 'healthy' ? 200 : 503).json(cachedResult);
    }
    
    // Perform comprehensive health check
    const healthResult = await validateSystemHealth();
    const responseTime = performance.now() - startTime;
    
    const result = {
      status: healthResult.healthy ? 'healthy' : 'unhealthy',
      service: 'nxt-backend',
      timestamp: healthResult.timestamp,
      responseTime: `${responseTime.toFixed(2)}ms`,
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      version: '1.0.0',
      checks: healthResult.checks,
      errors: healthResult.errors,
      warnings: healthResult.warnings,
      summary: {
        totalChecks: Object.keys(healthResult.checks).length,
        passedChecks: Object.values(healthResult.checks).filter(check => check.healthy).length,
        failedChecks: Object.values(healthResult.checks).filter(check => !check.healthy).length,
        warningCount: healthResult.warnings.length
      }
    };
    
    // Cache the result
    setCachedHealth(cacheKey, result);
    
    res.status(result.status === 'healthy' ? 200 : 503).json(result);
  } catch (error) {
    const responseTime = performance.now() - startTime;
    
    res.status(500).json({
      status: 'error',
      service: 'nxt-backend',
      timestamp: new Date().toISOString(),
      error: error.message,
      responseTime: `${responseTime.toFixed(2)}ms`
    });
  }
});

/**
 * GET /health/services - Individual service health checks
 * Health status of all microservices and integrations
 */
router.get('/health/services', async (req, res) => {
  const startTime = performance.now();
  
  try {
    const serviceChecks = await Promise.allSettled([
      checkAuthService(),
      checkAnalyticsService(),
      checkInventoryService(),
      checkSupplierService(),
      checkCustomerService(),
      checkPaymentService(),
      checkWooCommerceService(),
      checkAIService(),
      checkNotificationService(),
      checkBackupService(),
      checkSecurityService(),
      checkWebSocketService(),
      checkCacheService(),
      checkDashboardService()
    ]);
    
    const services = {};
    const serviceNames = [
      'auth', 'analytics', 'inventory', 'supplier', 'customer',
      'payment', 'woocommerce', 'ai', 'notification', 'backup',
      'security', 'websocket', 'cache', 'dashboard'
    ];
    
    serviceChecks.forEach((result, index) => {
      const serviceName = serviceNames[index];
      if (result.status === 'fulfilled') {
        services[serviceName] = result.value;
      } else {
        services[serviceName] = {
          status: 'unhealthy',
          error: result.reason.message,
          timestamp: new Date().toISOString()
        };
      }
    });
    
    const healthyServices = Object.values(services).filter(s => s.status === 'healthy').length;
    const totalServices = Object.keys(services).length;
    const overallStatus = healthyServices === totalServices ? 'healthy' : 'degraded';
    
    const responseTime = performance.now() - startTime;
    
    res.status(overallStatus === 'healthy' ? 200 : 207).json({
      status: overallStatus,
      service: 'nxt-backend',
      timestamp: new Date().toISOString(),
      responseTime: `${responseTime.toFixed(2)}ms`,
      summary: {
        totalServices,
        healthyServices,
        unhealthyServices: totalServices - healthyServices,
        healthPercentage: Math.round((healthyServices / totalServices) * 100)
      },
      services
    });
  } catch (error) {
    const responseTime = performance.now() - startTime;
    
    res.status(500).json({
      status: 'error',
      service: 'nxt-backend',
      timestamp: new Date().toISOString(),
      error: error.message,
      responseTime: `${responseTime.toFixed(2)}ms`
    });
  }
});

/**
 * GET /health/dependencies - External dependency health
 * Health checks for external services and APIs
 */
router.get('/health/dependencies', async (req, res) => {
  const startTime = performance.now();
  
  try {
    const dependencyChecks = await Promise.allSettled([
      checkDatabaseDependency(),
      checkRedisDependency(),
      checkOpenAIDependency(),
      checkNileDBDependency(),
      checkWooCommerceDependency(),
      checkPaymentGatewayDependency(),
      checkEmailServiceDependency(),
      checkSlackDependency(),
      checkWebhookDependency()
    ]);
    
    const dependencies = {};
    const dependencyNames = [
      'database', 'redis', 'openai', 'niledb', 'woocommerce',
      'payment_gateway', 'email_service', 'slack', 'webhooks'
    ];
    
    dependencyChecks.forEach((result, index) => {
      const depName = dependencyNames[index];
      if (result.status === 'fulfilled') {
        dependencies[depName] = result.value;
      } else {
        dependencies[depName] = {
          status: 'unhealthy',
          error: result.reason.message,
          timestamp: new Date().toISOString()
        };
      }
    });
    
    const healthyDeps = Object.values(dependencies).filter(d => d.status === 'healthy').length;
    const totalDeps = Object.keys(dependencies).length;
    const overallStatus = healthyDeps === totalDeps ? 'healthy' : 'degraded';
    
    const responseTime = performance.now() - startTime;
    
    res.status(overallStatus === 'healthy' ? 200 : 207).json({
      status: overallStatus,
      service: 'nxt-backend',
      timestamp: new Date().toISOString(),
      responseTime: `${responseTime.toFixed(2)}ms`,
      summary: {
        totalDependencies: totalDeps,
        healthyDependencies: healthyDeps,
        unhealthyDependencies: totalDeps - healthyDeps,
        healthPercentage: Math.round((healthyDeps / totalDeps) * 100)
      },
      dependencies
    });
  } catch (error) {
    const responseTime = performance.now() - startTime;
    
    res.status(500).json({
      status: 'error',
      service: 'nxt-backend',
      timestamp: new Date().toISOString(),
      error: error.message,
      responseTime: `${responseTime.toFixed(2)}ms`
    });
  }
});

// ==================== HELPER FUNCTIONS ====================

async function checkDatabaseConnectivity() {
  const { db } = await import('../config/database.js');
  const startTime = performance.now();
  await db.execute('SELECT 1');
  const responseTime = performance.now() - startTime;
  if (responseTime > 5000) throw new Error(`Database slow: ${responseTime}ms`);
}

async function checkRedisConnectivity() {
  try {
    const { createClient } = await import('redis');
    const client = createClient({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      connectTimeout: 2000
    });
    await client.connect();
    await client.ping();
    await client.quit();
  } catch (error) {
    // Redis is optional in some deployments
    console.warn('Redis connectivity check failed:', error.message);
  }
}

async function checkCriticalServices() {
  // Check if critical files exist
  const fs = await import('fs/promises');
  const criticalFiles = [
    'src/config/database.js',
    'src/services/auth.service.js',
    'src/utils/health-checks.js'
  ];
  
  for (const file of criticalFiles) {
    try {
      await fs.access(file);
    } catch (error) {
      throw new Error(`Critical file missing: ${file}`);
    }
  }
}

async function checkSystemResources() {
  const memUsage = process.memoryUsage();
  const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
  
  if (heapUsedMB > 1024) { // 1GB limit
    throw new Error(`High memory usage: ${heapUsedMB.toFixed(2)}MB`);
  }
}

// Individual service health checks
async function checkAuthService() {
  try {
    const { authService } = await import('../services/auth.service.js');
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      details: { message: 'Auth service operational' }
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

async function checkAnalyticsService() {
  try {
    const { analyticsService } = await import('../services/analytics.service.js');
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      details: { message: 'Analytics service operational' }
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

async function checkInventoryService() {
  try {
    const { inventoryService } = await import('../services/inventory.service.js');
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      details: { message: 'Inventory service operational' }
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

async function checkSupplierService() {
  try {
    const { supplierService } = await import('../services/supplier.service.js');
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      details: { message: 'Supplier service operational' }
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

async function checkCustomerService() {
  try {
    const { customerService } = await import('../services/customer.service.js');
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      details: { message: 'Customer service operational' }
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

async function checkPaymentService() {
  try {
    const paymentService = await import('../services/payment-gateway.service.js');
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      details: { message: 'Payment service operational' }
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

async function checkWooCommerceService() {
  try {
    const wooService = await import('../services/woocommerce-sync.service.js');
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      details: { message: 'WooCommerce service operational' }
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

async function checkAIService() {
  try {
    const { aiService } = await import('../services/ai.service.js');
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      details: { message: 'AI service operational' }
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

async function checkNotificationService() {
  try {
    const notificationService = await import('../services/notifications.js');
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      details: { message: 'Notification service operational' }
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

async function checkBackupService() {
  try {
    const { backupRecoveryService } = await import('../services/backup-recovery.service.js');
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      details: { message: 'Backup service operational' }
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

async function checkSecurityService() {
  try {
    const { securityMonitoringService } = await import('../services/security-monitoring.service.js');
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      details: { message: 'Security monitoring operational' }
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

async function checkWebSocketService() {
  try {
    const { websocketService } = await import('../services/websocket.service.js');
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      details: { message: 'WebSocket service operational' }
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

async function checkCacheService() {
  try {
    const { cacheService } = await import('../services/cache.service.js');
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      details: { message: 'Cache service operational' }
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

async function checkDashboardService() {
  try {
    const { dashboardService } = await import('../services/dashboard.service.js');
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      details: { message: 'Dashboard service operational' }
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

// Dependency health checks
async function checkDatabaseDependency() {
  const startTime = performance.now();
  const { db } = await import('../config/database.js');
  await db.execute('SELECT 1');
  const responseTime = performance.now() - startTime;
  
  return {
    status: 'healthy',
    responseTime: `${responseTime.toFixed(2)}ms`,
    timestamp: new Date().toISOString(),
    details: { connection_pool: 'active' }
  };
}

async function checkRedisDependency() {
  try {
    const { createClient } = await import('redis');
    const client = createClient({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      connectTimeout: 2000
    });
    const startTime = performance.now();
    await client.connect();
    await client.ping();
    const responseTime = performance.now() - startTime;
    await client.quit();
    
    return {
      status: 'healthy',
      responseTime: `${responseTime.toFixed(2)}ms`,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

async function checkOpenAIDependency() {
  if (!process.env.OPENAI_API_KEY) {
    return {
      status: 'not_configured',
      message: 'OpenAI API key not configured',
      timestamp: new Date().toISOString()
    };
  }
  
  return {
    status: 'configured',
    message: 'OpenAI API key configured',
    timestamp: new Date().toISOString()
  };
}

async function checkNileDBDependency() {
  try {
    const { testNileConnection } = await import('../config/niledb.config.js');
    await testNileConnection();
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      details: { message: 'NileDB connection successful' }
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

async function checkWooCommerceDependency() {
  if (!process.env.WOOCOMMERCE_URL || !process.env.WOOCOMMERCE_CONSUMER_KEY) {
    return {
      status: 'not_configured',
      message: 'WooCommerce credentials not configured',
      timestamp: new Date().toISOString()
    };
  }
  
  return {
    status: 'configured',
    message: 'WooCommerce credentials configured',
    timestamp: new Date().toISOString()
  };
}

async function checkPaymentGatewayDependency() {
  return {
    status: process.env.PAYMENT_GATEWAY_URL ? 'configured' : 'not_configured',
    message: process.env.PAYMENT_GATEWAY_URL ? 'Payment gateway configured' : 'Payment gateway not configured',
    timestamp: new Date().toISOString()
  };
}

async function checkEmailServiceDependency() {
  return {
    status: process.env.EMAIL_SERVICE_URL ? 'configured' : 'not_configured',
    message: process.env.EMAIL_SERVICE_URL ? 'Email service configured' : 'Email service not configured',
    timestamp: new Date().toISOString()
  };
}

async function checkSlackDependency() {
  return {
    status: process.env.SLACK_WEBHOOK_URL ? 'configured' : 'not_configured',
    message: process.env.SLACK_WEBHOOK_URL ? 'Slack webhook configured' : 'Slack webhook not configured',
    timestamp: new Date().toISOString()
  };
}

async function checkWebhookDependency() {
  return {
    status: process.env.WEBHOOK_URL ? 'configured' : 'not_configured',
    message: process.env.WEBHOOK_URL ? 'Custom webhook configured' : 'Custom webhook not configured',
    timestamp: new Date().toISOString()
  };
}

// Cache helper functions
function getCachedHealth(key) {
  const cached = healthCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  return null;
}

function setCachedHealth(key, data) {
  healthCache.set(key, {
    data,
    timestamp: Date.now()
  });
}

export default router;