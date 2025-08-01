/**
 * WebSocket Server Integration Module
 * Integrates WebSocket real-time service with the main backend server
 * 
 * Features:
 * - Production-ready Socket.io server setup
 * - NILEDB integration for real-time data
 * - Comprehensive error handling and monitoring
 * - Graceful shutdown procedures
 * - Health monitoring and metrics collection
 */

import { createServer } from 'http';
import express from 'express';
import cors from 'cors';
import { websocketRealTimeService } from './services/websocket-realtime.service.js';
import { nileDBRealTimeService } from './services/niledb-realtime.service.js';
import { testNileConnection, initializeNileDB } from './config/niledb.config.js';

class WebSocketServer {
    constructor(options = {}) {
        this.config = {
            port: process.env.WEBSOCKET_PORT || 4001,
            cors: {
                origin: process.env.CORS_ORIGIN || ["http://localhost:3000", "http://localhost:3001"],
                methods: ["GET", "POST"],
                credentials: true
            },
            enableMetrics: true,
            enableHealthCheck: true,
            ...options
        };

        this.app = null;
        this.httpServer = null;
        this.isRunning = false;
        this.startTime = null;
        this.metrics = {
            totalRequests: 0,
            totalConnections: 0,
            errors: 0,
            uptime: 0
        };

        // Bind methods
        this.start = this.start.bind(this);
        this.stop = this.stop.bind(this);
        this.getHealth = this.getHealth.bind(this);
    }

    /**
     * Initialize and start the WebSocket server
     */
    async start() {
        try {
            console.log('🚀 Starting WebSocket Server...');
            this.startTime = Date.now();

            // Initialize NILEDB connection
            await this.initializeNileDB();

            // Create Express app for health checks and metrics
            this.app = express();
            this.setupMiddleware();
            this.setupRoutes();

            // Create HTTP server
            this.httpServer = createServer(this.app);

            // Initialize NILEDB real-time service first
            console.log('🔄 Initializing NILEDB Real-Time Service...');
            const nileDBResult = await nileDBRealTimeService.initialize();
            if (!nileDBResult.success) {
                throw new Error(`NILEDB Real-Time Service failed: ${nileDBResult.error}`);
            }
            console.log('✅ NILEDB Real-Time Service initialized');

            // Initialize WebSocket service with NILEDB integration
            console.log('🔄 Initializing WebSocket Real-Time Service...');
            const websocketResult = await websocketRealTimeService.initialize(this.httpServer, {
                cors: this.config.cors
            });
            if (!websocketResult.success) {
                throw new Error(`WebSocket Service failed: ${websocketResult.error}`);
            }
            console.log('✅ WebSocket Real-Time Service initialized');

            // Setup service event handlers
            this.setupServiceHandlers();

            // Start HTTP server
            await this.startHTTPServer();

            // Setup graceful shutdown
            this.setupGracefulShutdown();

            this.isRunning = true;
            console.log('🎉 WebSocket Server started successfully!');
            console.log(`📡 Server running on port ${this.config.port}`);
            console.log(`🌐 Health check: http://localhost:${this.config.port}/health`);
            console.log(`📊 Metrics: http://localhost:${this.config.port}/metrics`);
            console.log(`🔌 WebSocket endpoint: ws://localhost:${this.config.port}`);

            return { success: true, port: this.config.port };
        } catch (error) {
            console.error('❌ Failed to start WebSocket Server:', error);
            await this.cleanup();
            return { success: false, error: error.message };
        }
    }

    /**
     * Initialize NILEDB connection and tables
     */
    async initializeNileDB() {
        console.log('🔄 Testing NILEDB connection...');
        const connectionTest = await testNileConnection();
        if (!connectionTest.success) {
            throw new Error(`NILEDB connection failed: ${connectionTest.error}`);
        }
        console.log('✅ NILEDB connection verified');

        console.log('🔄 Initializing NILEDB tables...');
        const initResult = await initializeNileDB();
        if (!initResult.success) {
            throw new Error(`NILEDB initialization failed: ${initResult.error}`);
        }
        console.log('✅ NILEDB tables initialized');
    }

    /**
     * Setup Express middleware
     */
    setupMiddleware() {
        // CORS middleware
        this.app.use(cors(this.config.cors));

        // JSON parsing
        this.app.use(express.json({ limit: '10mb' }));

        // Request logging and metrics
        this.app.use((req, res, next) => {
            this.metrics.totalRequests++;
            const start = Date.now();
            
            res.on('finish', () => {
                const duration = Date.now() - start;
                console.log(`${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
            });
            
            next();
        });

        // Error handling middleware
        this.app.use((error, req, res, next) => {
            this.metrics.errors++;
            console.error('Express error:', error);
            res.status(500).json({
                error: 'Internal server error',
                timestamp: new Date().toISOString()
            });
        });
    }

    /**
     * Setup Express routes
     */
    setupRoutes() {
        // Health check endpoint
        this.app.get('/health', this.getHealth);

        // Metrics endpoint
        this.app.get('/metrics', (req, res) => {
            const websocketMetrics = websocketRealTimeService.getStatus();
            const nileDBMetrics = nileDBRealTimeService.getMetrics();
            
            res.json({
                server: {
                    uptime: Date.now() - this.startTime,
                    isRunning: this.isRunning,
                    ...this.metrics
                },
                websocket: websocketMetrics,
                niledb: nileDBMetrics,
                timestamp: new Date().toISOString()
            });
        });

        // WebSocket client test page (for development)
        if (process.env.NODE_ENV === 'development') {
            this.app.get('/test', (req, res) => {
                res.send(this.generateTestPage());
            });
        }

        // Connected clients endpoint
        this.app.get('/clients', (req, res) => {
            const clients = websocketRealTimeService.getConnectedClients();
            res.json({
                totalClients: clients.length,
                clients: clients,
                timestamp: new Date().toISOString()
            });
        });

        // NILEDB alerts endpoint
        this.app.get('/alerts', async (req, res) => {
            try {
                const severity = req.query.severity || null;
                const alerts = await nileDBRealTimeService.getActiveAlerts(severity);
                res.json({
                    success: true,
                    alerts: alerts.data,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Acknowledge alert endpoint
        this.app.post('/alerts/:alertId/acknowledge', async (req, res) => {
            try {
                const { alertId } = req.params;
                const { acknowledgedBy } = req.body;
                
                const result = await nileDBRealTimeService.acknowledgeAlert(alertId, acknowledgedBy);
                res.json({
                    success: result.success,
                    data: result.data,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Recent changes endpoint
        this.app.get('/changes/:dataType', async (req, res) => {
            try {
                const { dataType } = req.params;
                const limit = parseInt(req.query.limit) || 50;
                
                const changes = await nileDBRealTimeService.getRecentChanges(dataType, limit);
                res.json({
                    success: true,
                    dataType,
                    changes: changes.data,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Root endpoint
        this.app.get('/', (req, res) => {
            res.json({
                service: 'WebSocket Real-Time Server',
                version: '2.0.0',
                status: 'running',
                features: [
                    'Real-time inventory updates',
                    'Live order tracking',
                    'Customer activity streaming',
                    'Dashboard updates',
                    'Push notifications',
                    'NILEDB integration'
                ],
                endpoints: {
                    health: '/health',
                    metrics: '/metrics',
                    clients: '/clients',
                    alerts: '/alerts',
                    changes: '/changes/:dataType',
                    websocket: 'ws://localhost:' + this.config.port
                },
                timestamp: new Date().toISOString()
            });
        });
    }

    /**
     * Setup service event handlers
     */
    setupServiceHandlers() {
        // WebSocket service events
        websocketRealTimeService.on('client:connected', (data) => {
            this.metrics.totalConnections++;
            console.log(`📊 Client connected: ${data.clientId} (Total: ${this.metrics.totalConnections})`);
        });

        websocketRealTimeService.on('client:disconnected', (data) => {
            console.log(`📊 Client disconnected: ${data.clientId}`);
        });

        websocketRealTimeService.on('client:error', (data) => {
            this.metrics.errors++;
            console.error(`🚨 WebSocket client error: ${data.clientId}`, data.error);
        });

        // NILEDB service events
        nileDBRealTimeService.on('changes:detected', (data) => {
            console.log(`🔄 Changes detected in ${data.dataType}: ${data.changes.length} items`);
        });

        nileDBRealTimeService.on('alert:triggered', (alert) => {
            console.log(`🚨 Alert triggered: ${alert.type} (${alert.severity})`);
            
            // Broadcast alert via WebSocket
            websocketRealTimeService.sendNotification({
                type: alert.type,
                priority: alert.severity,
                message: alert.title,
                persistent: alert.severity === 'critical'
            });
        });

        nileDBRealTimeService.on('detection:error', (data) => {
            this.metrics.errors++;
            console.error(`🚨 NILEDB detection error in ${data.dataType}:`, data.error);
        });

        // Cross-service integration
        nileDBRealTimeService.on('realtime:change', (data) => {
            // Broadcast NILEDB changes via WebSocket
            switch (data.type) {
                case 'inventory':
                    websocketRealTimeService.broadcastInventoryUpdate(data.change);
                    break;
                case 'orders':
                    websocketRealTimeService.broadcastOrderUpdate(data.change);
                    break;
                case 'customer_activity':
                    websocketRealTimeService.broadcastCustomerActivity(data.change);
                    break;
            }
        });
    }

    /**
     * Start HTTP server
     */
    async startHTTPServer() {
        return new Promise((resolve, reject) => {
            this.httpServer.listen(this.config.port, (error) => {
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * Health check handler
     */
    async getHealth(req, res) {
        try {
            const websocketHealth = websocketRealTimeService.getStatus();
            const nileDBHealth = nileDBRealTimeService.getMetrics();
            const nileConnectionTest = await testNileConnection();

            const health = {
                status: 'healthy',
                timestamp: new Date().toISOString(),
                uptime: Date.now() - this.startTime,
                services: {
                    websocket: {
                        status: websocketHealth.running ? 'healthy' : 'unhealthy',
                        connections: websocketHealth.connections,
                        metrics: websocketHealth.metrics
                    },
                    niledb: {
                        status: nileDBHealth.connectionHealth,
                        isInitialized: nileDBHealth.isInitialized,
                        queriesExecuted: nileDBHealth.queriesExecuted,
                        errorsOccurred: nileDBHealth.errorsOccurred
                    },
                    nileConnection: {
                        status: nileConnectionTest.success ? 'healthy' : 'unhealthy',
                        lastCheck: new Date().toISOString()
                    }
                }
            };

            // Determine overall health
            const allServicesHealthy = Object.values(health.services).every(
                service => service.status === 'healthy'
            );
            
            if (!allServicesHealthy) {
                health.status = 'degraded';
            }

            const statusCode = health.status === 'healthy' ? 200 : 503;
            res.status(statusCode).json(health);
        } catch (error) {
            console.error('Health check error:', error);
            res.status(503).json({
                status: 'unhealthy',
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Generate test page for development
     */
    generateTestPage() {
        return `
<!DOCTYPE html>
<html>
<head>
    <title>WebSocket Real-Time Test</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .container { max-width: 800px; margin: 0 auto; }
        .section { margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 5px; }
        .status { padding: 10px; margin: 10px 0; border-radius: 3px; }
        .connected { background-color: #d4edda; color: #155724; }
        .disconnected { background-color: #f8d7da; color: #721c24; }
        button { padding: 8px 16px; margin: 5px; cursor: pointer; }
        #log { height: 300px; overflow-y: scroll; background: #f8f9fa; padding: 10px; border: 1px solid #ddd; font-family: monospace; font-size: 12px; }
        .log-entry { margin: 2px 0; }
        .log-error { color: red; }
        .log-success { color: green; }
    </style>
    <script src="/socket.io/socket.io.js"></script>
</head>
<body>
    <div class="container">
        <h1>WebSocket Real-Time Test</h1>
        
        <div class="section">
            <h3>Connection Status</h3>
            <div id="status" class="status disconnected">Disconnected</div>
            <button onclick="connect()">Connect</button>
            <button onclick="disconnect()">Disconnect</button>
        </div>
        
        <div class="section">
            <h3>Subscriptions</h3>
            <button onclick="subscribeInventory()">Subscribe to Inventory</button>
            <button onclick="subscribeOrders()">Subscribe to Orders</button>
            <button onclick="subscribeDashboard()">Subscribe to Dashboard</button>
            <button onclick="subscribeNotifications()">Subscribe to Notifications</button>
        </div>
        
        <div class="section">
            <h3>Test Actions</h3>
            <button onclick="requestInventoryData()">Request Inventory Data</button>
            <button onclick="trackOrder('ORDER_123')">Track Order</button>
            <button onclick="sendHeartbeat()">Send Heartbeat</button>
        </div>
        
        <div class="section">
            <h3>Event Log</h3>
            <button onclick="clearLog()">Clear Log</button>
            <div id="log"></div>
        </div>
    </div>

    <script>
        let sockets = {};
        
        function log(message, type = 'info') {
            const logDiv = document.getElementById('log');
            const entry = document.createElement('div');
            entry.className = 'log-entry log-' + type;
            entry.textContent = new Date().toLocaleTimeString() + ': ' + message;
            logDiv.appendChild(entry);
            logDiv.scrollTop = logDiv.scrollHeight;
        }
        
        function updateStatus(status) {
            const statusDiv = document.getElementById('status');
            statusDiv.textContent = status;
            statusDiv.className = 'status ' + (status === 'Connected' ? 'connected' : 'disconnected');
        }
        
        function connect() {
            // Connect to main namespace
            sockets.main = io('/', {
                transports: ['polling', 'websocket']
            });
            
            sockets.main.on('connect', () => {
                updateStatus('Connected');
                log('Connected to main namespace', 'success');
            });
            
            sockets.main.on('disconnect', () => {
                updateStatus('Disconnected');
                log('Disconnected from main namespace', 'error');
            });
            
            sockets.main.on('connection:established', (data) => {
                log('Connection established: ' + JSON.stringify(data), 'success');
            });
            
            // Connect to specialized namespaces
            const namespaces = ['inventory', 'orders', 'dashboard', 'notifications'];
            namespaces.forEach(ns => {
                sockets[ns] = io('/' + ns);
                sockets[ns].on('connect', () => log('Connected to ' + ns + ' namespace', 'success'));
                sockets[ns].on('disconnect', () => log('Disconnected from ' + ns + ' namespace', 'error'));
                
                // Setup event listeners
                sockets[ns].onAny((eventName, ...args) => {
                    log(ns + ':' + eventName + ' - ' + JSON.stringify(args), 'info');
                });
            });
        }
        
        function disconnect() {
            Object.values(sockets).forEach(socket => socket.disconnect());
            sockets = {};
            updateStatus('Disconnected');
            log('All connections closed', 'info');
        }
        
        function subscribeInventory() {
            if (sockets.inventory) {
                sockets.inventory.emit('inventory:subscribe', {
                    productIds: ['PRODUCT_1', 'PRODUCT_2'],
                    warehouseIds: ['WAREHOUSE_1'],
                    lowStockOnly: true
                });
                log('Sent inventory subscription request', 'info');
            }
        }
        
        function subscribeOrders() {
            if (sockets.orders) {
                sockets.orders.emit('orders:subscribe', {
                    customerId: 'CUSTOMER_123',
                    trackingEnabled: true
                });
                log('Sent orders subscription request', 'info');
            }
        }
        
        function subscribeDashboard() {
            if (sockets.dashboard) {
                sockets.dashboard.emit('dashboard:subscribe', {
                    dashboardId: 'main',
                    widgets: ['inventory-summary', 'order-stats'],
                    metricsInterval: 5000
                });
                log('Sent dashboard subscription request', 'info');
            }
        }
        
        function subscribeNotifications() {
            if (sockets.notifications) {
                sockets.notifications.emit('notifications:subscribe', {
                    types: ['low_stock', 'order_update'],
                    priority: 'high'
                });
                log('Sent notifications subscription request', 'info');
            }
        }
        
        function requestInventoryData() {
            if (sockets.inventory) {
                sockets.inventory.emit('inventory:get-current', {
                    limit: 10
                });
                log('Requested current inventory data', 'info');
            }
        }
        
        function trackOrder(orderId) {
            if (sockets.orders) {
                sockets.orders.emit('orders:track', { orderId });
                log('Requested tracking for order: ' + orderId, 'info');
            }
        }
        
        function sendHeartbeat() {
            if (sockets.main) {
                sockets.main.emit('ping');
                log('Sent heartbeat', 'info');
            }
        }
        
        function clearLog() {
            document.getElementById('log').innerHTML = '';
        }
    </script>
</body>
</html>
        `;
    }

    /**
     * Setup graceful shutdown
     */
    setupGracefulShutdown() {
        const signals = ['SIGTERM', 'SIGINT', 'SIGUSR2'];
        
        signals.forEach(signal => {
            process.on(signal, async () => {
                console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
                await this.stop();
                process.exit(0);
            });
        });

        process.on('uncaughtException', async (error) => {
            console.error('❌ Uncaught Exception:', error);
            await this.stop();
            process.exit(1);
        });

        process.on('unhandledRejection', async (reason, promise) => {
            console.error('❌ Unhandled Rejection:', reason, 'at:', promise);
            await this.stop();
            process.exit(1);
        });
    }

    /**
     * Stop the WebSocket server
     */
    async stop() {
        if (!this.isRunning) {
            console.log('⚠️ Server is not running');
            return;
        }

        console.log('🛑 Stopping WebSocket Server...');
        this.isRunning = false;

        try {
            // Stop services
            await websocketRealTimeService.shutdown();
            await nileDBRealTimeService.shutdown();

            // Close HTTP server
            if (this.httpServer) {
                await new Promise((resolve) => {
                    this.httpServer.close(resolve);
                });
            }

            console.log('✅ WebSocket Server stopped successfully');
        } catch (error) {
            console.error('❌ Error during shutdown:', error);
        }

        await this.cleanup();
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        this.app = null;
        this.httpServer = null;
        this.isRunning = false;
        this.startTime = null;
    }

    /**
     * Get server metrics
     */
    getMetrics() {
        return {
            ...this.metrics,
            uptime: this.startTime ? Date.now() - this.startTime : 0,
            isRunning: this.isRunning
        };
    }
}

// Export server class and create default instance
export { WebSocketServer };
export const websocketServer = new WebSocketServer();

// Auto-start if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    websocketServer.start().catch(error => {
        console.error('❌ Failed to start WebSocket server:', error);
        process.exit(1);
    });
}

export default WebSocketServer;