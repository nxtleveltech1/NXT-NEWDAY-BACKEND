import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { dashboardService } from '../services/dashboard.service.js';
import { dashboardWebSocketService } from '../services/dashboard-websocket.service.js';
import dashboardRoutes from '../routes/dashboard.routes.js';
import { testNileConnection, initializeNileDB } from '../config/niledb.config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Dashboard Integration Module
 * Integrates real-time dashboard with the main application
 */

class DashboardIntegration {
  constructor() {
    this.isInitialized = false;
    this.server = null;
    this.app = null;
  }

  /**
   * Initialize dashboard integration with existing Express app
   */
  async initialize(app, server) {
    try {
      console.log('🚀 Initializing Dashboard Integration...');
      
      this.app = app;
      this.server = server;

      // Test NileDB connection first
      const nileConnection = await testNileConnection();
      if (nileConnection.success) {
        console.log('✅ NileDB connection established');
        
        // Initialize NileDB tables
        const nileInit = await initializeNileDB();
        if (nileInit.success) {
          console.log('✅ NileDB tables initialized');
        } else {
          console.warn('⚠️ NileDB table initialization failed:', nileInit.error);
        }
      } else {
        console.warn('⚠️ NileDB connection failed, dashboard will use fallback mode');
      }

      // Initialize dashboard service
      const serviceInit = await dashboardService.initialize();
      if (!serviceInit.success) {
        console.error('❌ Dashboard service initialization failed:', serviceInit.error);
        return { success: false, error: serviceInit.error };
      }

      // Initialize WebSocket service
      const wsInit = dashboardWebSocketService.initialize(server);
      if (!wsInit.success) {
        console.error('❌ Dashboard WebSocket service initialization failed:', wsInit.error);
        return { success: false, error: wsInit.error };
      }

      // Mount dashboard routes
      app.use('/api/dashboard', dashboardRoutes);

      // Serve dashboard static files
      const publicPath = path.join(__dirname, '../../public');
      app.use('/dashboard', express.static(publicPath));

      // Dashboard home route
      app.get('/dashboard', (req, res) => {
        res.sendFile(path.join(publicPath, 'dashboard.html'));
      });

      // Add dashboard middleware for request tracking
      app.use('/api', (req, res, next) => {
        const startTime = Date.now();
        
        res.on('finish', async () => {
          const responseTime = Date.now() - startTime;
          
          // Track API usage for dashboard
          try {
            await dashboardService.storeMetrics('api_usage', {
              endpoint: req.path,
              method: req.method,
              statusCode: res.statusCode,
              responseTime,
              timestamp: new Date(),
              userAgent: req.get('User-Agent'),
              ip: req.ip
            });
          } catch (error) {
            // Don't let tracking errors affect the API
            console.error('Error tracking API usage:', error);
          }
        });
        
        next();
      });

      this.isInitialized = true;
      console.log('✅ Dashboard Integration initialized successfully');
      
      return { success: true };
    } catch (error) {
      console.error('❌ Dashboard integration initialization failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Start dashboard services
   */
  async start() {
    if (!this.isInitialized) {
      throw new Error('Dashboard integration not initialized');
    }

    try {
      console.log('🎯 Starting dashboard services...');
      
      // Services are automatically started during initialization
      // This method is here for consistency and future extensions
      
      console.log('✅ Dashboard services started');
      return { success: true };
    } catch (error) {
      console.error('❌ Failed to start dashboard services:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get dashboard integration status
   */
  getStatus() {
    return {
      initialized: this.isInitialized,
      services: {
        dashboard: dashboardService.initialized,
        websocket: dashboardWebSocketService.isRunning,
        niledb: testNileConnection().then(result => result.success)
      },
      websocketStats: dashboardWebSocketService.getStats(),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Stop dashboard services
   */
  async stop() {
    try {
      console.log('🛑 Stopping dashboard services...');
      
      await dashboardService.shutdown();
      await dashboardWebSocketService.shutdown();
      
      this.isInitialized = false;
      console.log('✅ Dashboard services stopped');
      
      return { success: true };
    } catch (error) {
      console.error('❌ Error stopping dashboard services:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send notification to dashboard users
   */
  async sendNotification(type, data, targetStream = 'notifications') {
    if (!this.isInitialized) {
      console.warn('Dashboard integration not initialized, cannot send notification');
      return { success: false, error: 'Not initialized' };
    }

    try {
      return await dashboardWebSocketService.sendNotification(type, data, targetStream);
    } catch (error) {
      console.error('Error sending dashboard notification:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update dashboard metrics
   */
  async updateMetrics(category, data) {
    if (!this.isInitialized) {
      return { success: false, error: 'Not initialized' };
    }

    try {
      await dashboardService.storeMetrics(category, data);
      return { success: true };
    } catch (error) {
      console.error('Error updating dashboard metrics:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Broadcast real-time update
   */
  broadcastUpdate(streamName, data) {
    if (!this.isInitialized) {
      return;
    }

    try {
      dashboardWebSocketService.broadcastToStream(streamName, {
        type: 'data-update',
        data
      });
    } catch (error) {
      console.error('Error broadcasting dashboard update:', error);
    }
  }
}

// Create singleton instance
export const dashboardIntegration = new DashboardIntegration();

// Export class for testing
export { DashboardIntegration };