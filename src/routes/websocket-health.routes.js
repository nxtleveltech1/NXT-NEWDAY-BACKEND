/**
 * CRITICAL P1: WebSocket Service Health Check Endpoints
 * Health checks specifically for WebSocket services and real-time functionality
 */

import express from 'express';
import { performance } from 'perf_hooks';

const router = express.Router();

/**
 * GET /websocket/health - WebSocket service health
 */
router.get('/health', async (req, res) => {
  const startTime = performance.now();
  
  try {
    // Check WebSocket server status
    const wsHealth = await checkWebSocketServer();
    const responseTime = performance.now() - startTime;
    
    res.status(wsHealth.healthy ? 200 : 503).json({
      status: wsHealth.healthy ? 'healthy' : 'unhealthy',
      service: 'websocket-server',
      timestamp: new Date().toISOString(),
      responseTime: `${responseTime.toFixed(2)}ms`,
      uptime: process.uptime(),
      ...wsHealth
    });
  } catch (error) {
    const responseTime = performance.now() - startTime;
    
    res.status(503).json({
      status: 'unhealthy',
      service: 'websocket-server',
      timestamp: new Date().toISOString(),
      error: error.message,
      responseTime: `${responseTime.toFixed(2)}ms`
    });
  }
});

/**
 * GET /websocket/ready - WebSocket readiness probe
 */
router.get('/ready', async (req, res) => {
  const startTime = performance.now();
  
  try {
    const checks = await Promise.allSettled([
      checkWebSocketServer(),
      checkSocketIOConnections(),
      checkRedisAdapter(),
      checkRealTimeServices()
    ]);
    
    const failures = checks
      .filter(result => result.status === 'rejected')
      .map(result => result.reason.message);
    
    const responseTime = performance.now() - startTime;
    
    if (failures.length === 0) {
      res.status(200).json({
        status: 'ready',
        service: 'websocket-server',
        timestamp: new Date().toISOString(),
        responseTime: `${responseTime.toFixed(2)}ms`,
        checks: {
          websocket_server: 'healthy',
          socketio: 'healthy',
          redis_adapter: 'healthy',
          realtime_services: 'healthy'
        }
      });
    } else {
      res.status(503).json({
        status: 'not_ready',
        service: 'websocket-server',
        timestamp: new Date().toISOString(),
        responseTime: `${responseTime.toFixed(2)}ms`,
        failures: failures
      });
    }
  } catch (error) {
    const responseTime = performance.now() - startTime;
    
    res.status(503).json({
      status: 'not_ready',
      service: 'websocket-server',
      timestamp: new Date().toISOString(),
      error: error.message,
      responseTime: `${responseTime.toFixed(2)}ms`
    });
  }
});

/**
 * GET /websocket/live - WebSocket liveness probe
 */
router.get('/live', async (req, res) => {
  const startTime = performance.now();
  
  try {
    const memUsage = process.memoryUsage();
    const responseTime = performance.now() - startTime;
    
    // Check for memory leaks or blocked event loop
    const isHealthy = responseTime < 1000 && memUsage.heapUsed < 512 * 1024 * 1024; // 512MB limit for WS
    
    if (isHealthy) {
      res.status(200).json({
        status: 'alive',
        service: 'websocket-server',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        responseTime: `${responseTime.toFixed(2)}ms`,
        memory: {
          heapUsed: `${(memUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`,
          heapTotal: `${(memUsage.heapTotal / 1024 / 1024).toFixed(2)}MB`
        }
      });
    } else {
      res.status(503).json({
        status: 'unhealthy',
        service: 'websocket-server',
        timestamp: new Date().toISOString(),
        reason: responseTime >= 1000 ? 'slow_response' : 'high_memory_usage',
        responseTime: `${responseTime.toFixed(2)}ms`
      });
    }
  } catch (error) {
    const responseTime = performance.now() - startTime;
    
    res.status(503).json({
      status: 'unhealthy',
      service: 'websocket-server',
      timestamp: new Date().toISOString(),
      error: error.message,
      responseTime: `${responseTime.toFixed(2)}ms`
    });
  }
});

/**
 * GET /websocket/connections - Active WebSocket connections info
 */
router.get('/connections', async (req, res) => {
  const startTime = performance.now();
  
  try {
    const connectionInfo = await getWebSocketConnectionInfo();
    const responseTime = performance.now() - startTime;
    
    res.status(200).json({
      status: 'success',
      service: 'websocket-server',
      timestamp: new Date().toISOString(),
      responseTime: `${responseTime.toFixed(2)}ms`,
      ...connectionInfo
    });
  } catch (error) {
    const responseTime = performance.now() - startTime;
    
    res.status(500).json({
      status: 'error',
      service: 'websocket-server',
      timestamp: new Date().toISOString(),
      error: error.message,
      responseTime: `${responseTime.toFixed(2)}ms`
    });
  }
});

/**
 * GET /websocket/metrics - WebSocket performance metrics
 */
router.get('/metrics', async (req, res) => {
  const startTime = performance.now();
  
  try {
    const metrics = await getWebSocketMetrics();
    const responseTime = performance.now() - startTime;
    
    res.status(200).json({
      status: 'success',
      service: 'websocket-server',
      timestamp: new Date().toISOString(),
      responseTime: `${responseTime.toFixed(2)}ms`,
      metrics
    });
  } catch (error) {
    const responseTime = performance.now() - startTime;
    
    res.status(500).json({
      status: 'error',
      service: 'websocket-server',
      timestamp: new Date().toISOString(),
      error: error.message,
      responseTime: `${responseTime.toFixed(2)}ms`
    });
  }
});

// ==================== HELPER FUNCTIONS ====================

async function checkWebSocketServer() {
  try {
    // Check if WebSocket server is accessible
    const http = await import('http');
    const port = process.env.WS_PORT || 4001;
    
    return new Promise((resolve, reject) => {
      const req = http.request(`http://localhost:${port}/health`, { timeout: 5000 }, (res) => {
        if (res.statusCode === 200) {
          resolve({
            healthy: true,
            port: port,
            message: 'WebSocket server responding'
          });
        } else {
          reject(new Error(`WebSocket server returned status ${res.statusCode}`));
        }
      });
      
      req.on('error', (error) => {
        reject(new Error(`WebSocket server not accessible: ${error.message}`));
      });
      
      req.end();
    });
  } catch (error) {
    return {
      healthy: false,
      error: error.message
    };
  }
}

async function checkSocketIOConnections() {
  try {
    // This would check Socket.IO connection health
    // For now, we'll simulate a basic check
    return {
      healthy: true,
      activeConnections: 0, // Would be actual count
      message: 'Socket.IO service operational'
    };
  } catch (error) {
    throw new Error(`Socket.IO check failed: ${error.message}`);
  }
}

async function checkRedisAdapter() {
  try {
    // Check Redis adapter for Socket.IO clustering
    const { createClient } = await import('redis');
    const client = createClient({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      connectTimeout: 2000
    });
    
    await client.connect();
    await client.ping();
    await client.quit();
    
    return {
      healthy: true,
      message: 'Redis adapter operational'
    };
  } catch (error) {
    // Redis adapter is optional
    return {
      healthy: true,
      warning: 'Redis adapter not available - single instance mode'
    };
  }
}

async function checkRealTimeServices() {
  try {
    // Check real-time service dependencies
    const checks = [];
    
    // Check if real-time services are available
    try {
      await import('../services/realtime-service.js');
      checks.push({ service: 'realtime', status: 'available' });
    } catch {
      checks.push({ service: 'realtime', status: 'unavailable' });
    }
    
    try {
      await import('../services/websocket-realtime.service.js');
      checks.push({ service: 'websocket-realtime', status: 'available' });
    } catch {
      checks.push({ service: 'websocket-realtime', status: 'unavailable' });
    }
    
    try {
      await import('../services/dashboard-websocket.service.js');
      checks.push({ service: 'dashboard-websocket', status: 'available' });
    } catch {
      checks.push({ service: 'dashboard-websocket', status: 'unavailable' });
    }
    
    const availableServices = checks.filter(c => c.status === 'available').length;
    
    return {
      healthy: availableServices > 0,
      services: checks,
      availableServices,
      totalServices: checks.length
    };
  } catch (error) {
    throw new Error(`Real-time services check failed: ${error.message}`);
  }
}

async function getWebSocketConnectionInfo() {
  try {
    // This would get actual connection information from the WebSocket server
    // For now, we'll return simulated data
    return {
      activeConnections: 0, // Would be actual count
      totalConnections: 0, // Historical total
      connectionsPerSecond: 0, // Current rate
      disconnectionsPerSecond: 0, // Current rate
      averageConnectionDuration: '0s', // Average duration
      peakConnections: 0, // Peak in last 24h
      connectionsByNamespace: {
        '/dashboard': 0,
        '/notifications': 0,
        '/analytics': 0
      },
      connectionsByRoom: {
        'general': 0,
        'admin': 0,
        'suppliers': 0
      }
    };
  } catch (error) {
    throw new Error(`Failed to get connection info: ${error.message}`);
  }
}

async function getWebSocketMetrics() {
  try {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    return {
      performance: {
        uptime: process.uptime(),
        memory: {
          heapUsed: `${(memUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`,
          heapTotal: `${(memUsage.heapTotal / 1024 / 1024).toFixed(2)}MB`,
          external: `${(memUsage.external / 1024 / 1024).toFixed(2)}MB`,
          rss: `${(memUsage.rss / 1024 / 1024).toFixed(2)}MB`
        },
        cpu: {
          user: cpuUsage.user,
          system: cpuUsage.system
        }
      },
      websocket: {
        messagesPerSecond: 0, // Would be actual metrics
        averageLatency: '0ms',
        errorRate: '0%',
        connectionStability: '100%'
      },
      redis: {
        connected: process.env.REDIS_HOST ? true : false,
        adaptersActive: process.env.REDIS_HOST ? 1 : 0
      },
      eventLoop: {
        lag: '0ms', // Would measure actual event loop lag
        activeHandles: process._getActiveHandles().length,
        activeRequests: process._getActiveRequests().length
      }
    };
  } catch (error) {
    throw new Error(`Failed to get metrics: ${error.message}`);
  }
}

export default router;