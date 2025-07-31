import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import responseTime from 'response-time';

// Routes
import authRoutes from './src/routes/auth.routes.js';
import mysqlRoutes from './src/routes/mysql.routes.js';
import mcpRoutes from './src/routes/mcp.routes.js';

// Middleware
import { protect } from './src/middleware/auth.middleware.js';

// Services
import { realtimeService } from './src/services/realtime-service.js';
import { analyticsService } from './src/services/analytics.service.js';
import { mcpIntegrationService } from './src/services/mcp-integration.service.js';
import backgroundServiceOrchestrator from './src/services/background-service-orchestrator.service.js';
import materializedViewRefreshService from './src/services/materialized-view-refresh.service.js';
import { integrationMonitoringService } from './src/services/integration-monitoring.service.js';
import cacheService from './src/services/cache.service.js';

// Database
import { closePool } from './src/config/database.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

// Basic middleware
app.use(cors());
app.use(helmet());
app.use(compression());
app.use(responseTime());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Mount auth routes
app.use("/api/auth", authRoutes);

// --- Feature-flagged routes from unified-extractor ---
// These routes are enabled via environment variables for better control across environments.

if (process.env.ENABLE_WOOCOMMERCE_INTEGRATION === 'true') {
  import("./src/routes/woocommerce-integration.routes.js").then(route => {
    app.use("/api/woocommerce", protect, route.default);
    console.log("✅ WooCommerce integration routes enabled.");
  }).catch(err => console.error("Failed to load WooCommerce routes:", err));

  import("./src/routes/woocommerce-sync.routes.js").then(route => {
    app.use("/api/woocommerce-sync", route.default); // Enhanced bidirectional sync
    console.log("✅ WooCommerce sync routes enabled.");
  }).catch(err => console.error("Failed to load WooCommerce sync routes:", err));
}

if (process.env.ENABLE_DATA_IMPORT === 'true') {
  import("./src/routes/data-import.routes.js").then(route => {
    app.use("/api/data-import", protect, route.default);
    console.log("✅ Data import routes enabled.");
  }).catch(err => console.error("Failed to load data import routes:", err));
}

if (process.env.ENABLE_SUPPLY_CHAIN_EXTRACT === 'true') {
  import("./src/routes/supply-chain-extract.routes.js").then(route => {
    app.use("/api/supply-chain-extract", protect, route.default);
    console.log("✅ Supply chain extract routes enabled.");
  }).catch(err => console.error("Failed to load supply chain extract routes:", err));
}

app.use("/api/mysql", mysqlRoutes);
app.use("/api/mcp", mcpRoutes);

// Server startup with WebSocket support
async function startServer() {
  try {
    // Initialize essential services first
    await realtimeService.initialize();
    await analyticsService.initialize();

    // Initialize MCP integration service
    try {
      console.log('🔌 Initializing MCP integration service...');
      await mcpIntegrationService.initializeConnections();
      console.log('✅ MCP integration service started successfully');
    } catch (error) {
      console.error('❌ Failed to start MCP integration service:', error);
      console.warn('⚠️ MCP services will be unavailable');
    }

    // Initialize background service orchestrator (handles all background services)
    try {
      console.log('🎯 Starting background service orchestrator with API priority optimization...');
      await backgroundServiceOrchestrator.initialize();
      console.log('✅ Background service orchestrator started successfully');
    } catch (error) {
      console.error('❌ Failed to start background service orchestrator:', error);
      console.warn('⚠️ Falling back to individual service initialization...');
      // Fallback: Initialize materialized view refresh service individually
      try {
        await materializedViewRefreshService.createMaterializedViews();
        await materializedViewRefreshService.initialize();
        console.log('Materialized view refresh service started (fallback mode)');
      } catch (fallbackError) {
        console.error('Failed to start materialized view refresh service (fallback):', fallbackError);
        // Continue without materialized views
      }
    }

    // Start the HTTP server
    const server = app.listen(port, () => {
      console.log(`🚀 Server running on port ${port}`);
    });

    // Enhanced graceful shutdown with orchestrator and cache cleanup
    process.on('SIGTERM', async () => {
      console.log('SIGTERM received, shutting down gracefully');
      try {
        // Stop background service orchestrator first
        await backgroundServiceOrchestrator.shutdown();

        // Then stop other services
        integrationMonitoringService.stopMonitoring();
        await realtimeService.cleanup();
        await mcpIntegrationService.shutdown();
        await cacheService.disconnect();

        // Close database pool
        await closePool();

        server.close(() => {
          console.log('Server closed');
          process.exit(0);
        });
      } catch (error) {
        console.error('Error during graceful shutdown:', error);
        process.exit(1);
      }
    });

    process.on('SIGINT', async () => {
      console.log('SIGINT received, shutting down gracefully');
      try {
        // Stop background service orchestrator first
        await backgroundServiceOrchestrator.shutdown();

        // Then stop other services
        integrationMonitoringService.stopMonitoring();
        await realtimeService.cleanup();
        await mcpIntegrationService.shutdown();
        await cacheService.disconnect();

        // Close database pool
        await closePool();

        server.close(() => {
          console.log('Server closed');
          process.exit(0);
        });
      } catch (error) {
        console.error('Error during graceful shutdown:', error);
        process.exit(1);
      }
    });

  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();
