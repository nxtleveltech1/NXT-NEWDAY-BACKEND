const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const { RateLimiterMemory } = require('rate-limiter-flexible');
require('dotenv').config();

const PluginManager = require('./core/PluginManager');
const EventBus = require('./core/EventBus');
const AnalyticsEngine = require('./core/AnalyticsEngine');
const WebSocketManager = require('./streaming/WebSocketManager');
const logger = require('./utils/logger');
const config = require('../config/config');

class AIAnalyticsServer {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = socketIo(this.server, {
      cors: {
        origin: process.env.FRONTEND_URL || "http://localhost:3000",
        methods: ["GET", "POST"]
      }
    });
    
    this.pluginManager = new PluginManager();
    this.eventBus = new EventBus();
    this.analyticsEngine = new AnalyticsEngine(this.eventBus);
    this.wsManager = new WebSocketManager(this.io, this.eventBus);
    
    this.setupMiddleware();
    this.setupRateLimiting();
    this.setupRoutes();
    this.setupPlugins();
    this.setupEventHandlers();
  }

  setupMiddleware() {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
    }));

    this.app.use(cors({
      origin: process.env.FRONTEND_URL || "http://localhost:3000",
      credentials: true
    }));

    this.app.use(compression());
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Request logging
    this.app.use((req, res, next) => {
      logger.info(`${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        timestamp: new Date().toISOString()
      });
      next();
    });
  }

  setupRateLimiting() {
    const rateLimiter = new RateLimiterMemory({
      keyGetter: (req) => req.ip,
      points: 100, // Number of requests
      duration: 60, // Per 60 seconds
    });

    this.app.use(async (req, res, next) => {
      try {
        await rateLimiter.consume(req.ip);
        next();
      } catch (rejRes) {
        res.status(429).json({
          error: 'Rate limit exceeded',
          resetTime: new Date(Date.now() + rejRes.msBeforeNext)
        });
      }
    });
  }

  setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version,
        plugins: this.pluginManager.getLoadedPlugins().map(p => p.name)
      });
    });

    // Core analytics routes
    this.app.use('/api/analytics', require('./routes/analytics'));
    this.app.use('/api/insights', require('./routes/insights'));
    this.app.use('/api/predictions', require('./routes/predictions'));
    this.app.use('/api/streaming', require('./routes/streaming'));
    this.app.use('/api/plugins', require('./routes/plugins'));
    this.app.use('/api/dashboard', require('./routes/dashboard'));

    // Plugin routes (dynamically loaded)
    this.app.use('/api/plugins', (req, res, next) => {
      const pluginName = req.path.split('/')[1];
      const plugin = this.pluginManager.getPlugin(pluginName);
      
      if (plugin && plugin.router) {
        plugin.router(req, res, next);
      } else {
        next();
      }
    });

    // Error handling
    this.app.use((err, req, res, next) => {
      logger.error('Unhandled error:', err);
      res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
      });
    });

    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({
        error: 'Not found',
        path: req.originalUrl
      });
    });
  }

  async setupPlugins() {
    try {
      // Load core plugins
      await this.pluginManager.loadPlugin('user-behavior');
      await this.pluginManager.loadPlugin('performance');
      await this.pluginManager.loadPlugin('predictive');
      
      // Load custom plugins from directory
      await this.pluginManager.loadPluginsFromDirectory('./plugins/custom');
      
      logger.info(`Loaded ${this.pluginManager.getLoadedPlugins().length} plugins`);
    } catch (error) {
      logger.error('Error loading plugins:', error);
    }
  }

  setupEventHandlers() {
    // Handle analytics events
    this.eventBus.on('analytics:processed', (data) => {
      this.wsManager.broadcast('analytics:update', data);
    });

    this.eventBus.on('insight:generated', (insight) => {
      this.wsManager.broadcast('insight:new', insight);
    });

    this.eventBus.on('prediction:ready', (prediction) => {
      this.wsManager.broadcast('prediction:update', prediction);
    });

    this.eventBus.on('alert:triggered', (alert) => {
      this.wsManager.broadcast('alert:critical', alert);
      logger.warn('Alert triggered:', alert);
    });
  }

  async start() {
    const port = process.env.ANALYTICS_PORT || 4000;
    
    try {
      // Initialize analytics engine
      await this.analyticsEngine.initialize();
      
      // Start server
      this.server.listen(port, () => {
        logger.info(`AI Analytics Server running on port ${port}`);
        logger.info(`WebSocket server ready for real-time connections`);
        logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
      });

      // Graceful shutdown
      process.on('SIGTERM', () => this.shutdown());
      process.on('SIGINT', () => this.shutdown());
      
    } catch (error) {
      logger.error('Failed to start server:', error);
      process.exit(1);
    }
  }

  async shutdown() {
    logger.info('Shutting down AI Analytics Server...');
    
    try {
      // Close WebSocket connections
      this.wsManager.closeAll();
      
      // Stop analytics engine
      await this.analyticsEngine.shutdown();
      
      // Unload plugins
      await this.pluginManager.unloadAllPlugins();
      
      // Close server
      this.server.close(() => {
        logger.info('Server shutdown complete');
        process.exit(0);
      });
    } catch (error) {
      logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  }
}

// Start server if this file is run directly
if (require.main === module) {
  const server = new AIAnalyticsServer();
  server.start();
}

module.exports = AIAnalyticsServer;