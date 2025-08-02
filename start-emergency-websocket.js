#!/usr/bin/env node

/**
 * P1 EMERGENCY WebSocket Server Startup
 * Simplified, working real-time server for immediate deployment
 */

import { createServer } from 'http';
import express from 'express';
import cors from 'cors';
import { emergencyWebSocketService } from './src/services/websocket-emergency.service.js';
import { testNileConnection, initializeNileDB } from './src/config/niledb.config.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const PORT = process.env.WEBSOCKET_PORT || 4001;
const CORS_ORIGINS = process.env.CORS_ORIGIN ? 
    process.env.CORS_ORIGIN.split(',') : 
    ["http://localhost:3000", "http://localhost:3001"];

console.log(`
╔══════════════════════════════════════════════════════════════╗
║                   P1 EMERGENCY WEBSOCKET                    ║
║                    Real-Time Server                         ║
╠══════════════════════════════════════════════════════════════╣
║  🚨 Emergency Mode: Simplified & Reliable                  ║
║  📡 Real-time Dashboard Updates                             ║
║  🔌 WebSocket Connections                                   ║
║  📊 NILEDB Integration                                      ║
║  🔔 Live Notifications                                      ║
╚══════════════════════════════════════════════════════════════╝
`);

async function startEmergencyServer() {
    try {
        console.log('🚨 P1 EMERGENCY: Starting WebSocket server...');
        
        // Test NILEDB connection
        console.log('🔍 Testing NILEDB connection...');
        const nileTest = await testNileConnection();
        if (!nileTest.success) {
            throw new Error(`NILEDB connection failed: ${nileTest.error}`);
        }
        console.log('✅ NILEDB connection verified');

        // Initialize NILEDB tables
        console.log('🔄 Initializing NILEDB tables...');
        const initResult = await initializeNileDB();
        if (!initResult.success) {
            throw new Error(`NILEDB initialization failed: ${initResult.error}`);
        }
        console.log('✅ NILEDB tables ready');

        // Create Express app
        const app = express();
        
        // Middleware
        app.use(cors({
            origin: CORS_ORIGINS,
            methods: ["GET", "POST"],
            credentials: true
        }));
        app.use(express.json());

        // Health check endpoint
        app.get('/health', async (req, res) => {
            try {
                const nileHealth = await testNileConnection();
                const wsStatus = emergencyWebSocketService.getStatus();
                
                const health = {
                    status: 'healthy',
                    timestamp: new Date().toISOString(),
                    services: {
                        websocket: {
                            status: wsStatus.running ? 'healthy' : 'unhealthy',
                            connections: wsStatus.connections,
                            uptime: wsStatus.uptime
                        },
                        niledb: {
                            status: nileHealth.success ? 'healthy' : 'unhealthy',
                            lastCheck: new Date().toISOString()
                        }
                    },
                    emergencyMode: true
                };

                const statusCode = health.services.websocket.status === 'healthy' && 
                                 health.services.niledb.status === 'healthy' ? 200 : 503;
                
                res.status(statusCode).json(health);
            } catch (error) {
                res.status(503).json({
                    status: 'unhealthy',
                    error: error.message,
                    timestamp: new Date().toISOString(),
                    emergencyMode: true
                });
            }
        });

        // Metrics endpoint
        app.get('/metrics', (req, res) => {
            const status = emergencyWebSocketService.getStatus();
            res.json({
                server: {
                    uptime: status.uptime,
                    emergencyMode: true
                },
                websocket: status,
                timestamp: new Date().toISOString()
            });
        });

        // Connected clients endpoint
        app.get('/clients', (req, res) => {
            const clients = emergencyWebSocketService.getConnectedClients();
            res.json({
                totalClients: clients.length,
                clients: clients,
                emergencyMode: true,
                timestamp: new Date().toISOString()
            });
        });

        // Emergency test endpoint
        app.get('/emergency-test', async (req, res) => {
            try {
                // Send test notification
                await emergencyWebSocketService.sendNotification({
                    type: 'emergency_test',
                    priority: 'high',
                    message: 'P1 Emergency WebSocket test notification',
                    persistent: false
                });

                res.json({
                    success: true,
                    message: 'Emergency test notification sent',
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Development test page
        if (process.env.NODE_ENV === 'development') {
            app.get('/test', (req, res) => {
                res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>P1 Emergency WebSocket Test</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f0f0f0; }
        .container { max-width: 800px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .emergency { background: #ff4444; color: white; padding: 10px; border-radius: 5px; margin-bottom: 20px; text-align: center; font-weight: bold; }
        .status { padding: 10px; margin: 10px 0; border-radius: 5px; }
        .connected { background-color: #d4edda; color: #155724; }
        .disconnected { background-color: #f8d7da; color: #721c24; }
        button { padding: 10px 15px; margin: 5px; cursor: pointer; border: none; border-radius: 3px; background: #007bff; color: white; }
        button:hover { background: #0056b3; }
        #log { height: 300px; overflow-y: scroll; background: #f8f9fa; padding: 10px; border: 1px solid #ddd; font-family: monospace; font-size: 12px; }
        .log-entry { margin: 2px 0; }
        .log-error { color: red; }
        .log-success { color: green; }
        .log-emergency { color: #ff4444; font-weight: bold; }
    </style>
    <script src="/socket.io/socket.io.js"></script>
</head>
<body>
    <div class="container">
        <div class="emergency">🚨 P1 EMERGENCY WEBSOCKET TEST 🚨</div>
        
        <h1>Real-Time WebSocket Test</h1>
        
        <div id="status" class="status disconnected">Disconnected</div>
        
        <div>
            <button onclick="connect()">Connect</button>
            <button onclick="disconnect()">Disconnect</button>
            <button onclick="testDashboard()">Test Dashboard</button>
            <button onclick="testInventory()">Test Inventory</button>
            <button onclick="testNotifications()">Test Notifications</button>
            <button onclick="sendHeartbeat()">Heartbeat</button>
        </div>
        
        <h3>Event Log</h3>
        <button onclick="clearLog()">Clear Log</button>
        <div id="log"></div>
    </div>

    <script>
        let socket = null;
        let dashboardSocket = null;
        let inventorySocket = null;
        let notificationsSocket = null;
        
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
            // Main connection
            socket = io('/', { transports: ['polling', 'websocket'] });
            
            socket.on('connect', () => {
                updateStatus('Connected');
                log('🚨 EMERGENCY: Connected to main namespace', 'emergency');
            });
            
            socket.on('disconnect', () => {
                updateStatus('Disconnected');
                log('🚨 EMERGENCY: Disconnected from main namespace', 'error');
            });
            
            socket.on('connection:established', (data) => {
                log('🚨 EMERGENCY: Connection established - ' + JSON.stringify(data), 'success');
            });
            
            socket.on('system:update', (data) => {
                log('📊 System update: ' + JSON.stringify(data.data), 'info');
            });
            
            // Connect to specialized namespaces
            dashboardSocket = io('/dashboard');
            inventorySocket = io('/inventory');
            notificationsSocket = io('/notifications');
            
            dashboardSocket.on('connect', () => log('📊 Dashboard namespace connected', 'success'));
            inventorySocket.on('connect', () => log('📦 Inventory namespace connected', 'success'));
            notificationsSocket.on('connect', () => log('🔔 Notifications namespace connected', 'success'));
            
            // Dashboard events
            dashboardSocket.on('dashboard:data', (data) => {
                log('📊 Dashboard data: ' + JSON.stringify(data), 'success');
            });
            
            dashboardSocket.on('dashboard:live-update', (data) => {
                log('📊 Live dashboard update: ' + JSON.stringify(data.data), 'info');
            });
            
            // Inventory events
            inventorySocket.on('inventory:data', (data) => {
                log('📦 Inventory data: ' + JSON.stringify(data), 'success');
            });
            
            // Notification events
            notificationsSocket.on('notification', (data) => {
                log('🔔 Notification: ' + JSON.stringify(data.data), 'emergency');
            });
        }
        
        function disconnect() {
            if (socket) socket.disconnect();
            if (dashboardSocket) dashboardSocket.disconnect();
            if (inventorySocket) inventorySocket.disconnect();
            if (notificationsSocket) notificationsSocket.disconnect();
            updateStatus('Disconnected');
            log('🚨 EMERGENCY: All connections closed', 'info');
        }
        
        function testDashboard() {
            if (dashboardSocket) {
                dashboardSocket.emit('dashboard:subscribe', {
                    widgets: ['system-metrics', 'niledb-metrics']
                });
                log('📊 Dashboard subscription sent', 'info');
            }
        }
        
        function testInventory() {
            if (inventorySocket) {
                inventorySocket.emit('inventory:subscribe', {});
                log('📦 Inventory subscription sent', 'info');
            }
        }
        
        function testNotifications() {
            if (notificationsSocket) {
                notificationsSocket.emit('notifications:subscribe', {});
                log('🔔 Notifications subscription sent', 'info');
            }
            
            // Also trigger server-side test
            fetch('/emergency-test')
                .then(response => response.json())
                .then(data => log('🚨 Emergency test triggered: ' + data.message, 'emergency'))
                .catch(error => log('❌ Test error: ' + error.message, 'error'));
        }
        
        function sendHeartbeat() {
            if (socket) {
                socket.emit('ping');
                log('💓 Heartbeat sent', 'info');
                
                socket.on('pong', (data) => {
                    log('💓 Heartbeat response: ' + JSON.stringify(data), 'success');
                });
            }
        }
        
        function clearLog() {
            document.getElementById('log').innerHTML = '';
        }
        
        // Auto-connect for testing
        setTimeout(connect, 1000);
    </script>
</body>
</html>
                `);
            });
        }

        // Root endpoint
        app.get('/', (req, res) => {
            res.json({
                service: 'P1 Emergency WebSocket Server',
                version: '1.0.0-emergency',
                status: 'running',
                emergencyMode: true,
                features: [
                    'Real-time dashboard updates',
                    'Live system monitoring',
                    'Emergency notifications',
                    'NILEDB integration'
                ],
                endpoints: {
                    health: '/health',
                    metrics: '/metrics',
                    clients: '/clients',
                    emergencyTest: '/emergency-test',
                    websocket: 'ws://localhost:' + PORT
                },
                timestamp: new Date().toISOString()
            });
        });

        // Create HTTP server
        const httpServer = createServer(app);

        // Initialize WebSocket service
        console.log('🚀 Initializing emergency WebSocket service...');
        const result = await emergencyWebSocketService.initialize(httpServer, {
            cors: {
                origin: CORS_ORIGINS,
                methods: ["GET", "POST"],
                credentials: true
            }
        });

        if (!result.success) {
            throw new Error(result.error);
        }

        // Start HTTP server
        httpServer.listen(PORT, () => {
            console.log('\n🎉 P1 EMERGENCY SERVER STARTED!');
            console.log('╔══════════════════════════════════════════════════════════╗');
            console.log('║                  CONNECTION ENDPOINTS                    ║');
            console.log('╠══════════════════════════════════════════════════════════╣');
            console.log(`║  🌐 HTTP Server:     http://localhost:${PORT}                ║`);
            console.log(`║  🔌 WebSocket:       ws://localhost:${PORT}                  ║`);
            console.log(`║  📊 Health Check:    http://localhost:${PORT}/health         ║`);
            console.log(`║  📈 Metrics:         http://localhost:${PORT}/metrics        ║`);
            console.log(`║  👥 Clients:         http://localhost:${PORT}/clients        ║`);
            console.log(`║  🚨 Emergency Test:  http://localhost:${PORT}/emergency-test ║`);
            
            if (process.env.NODE_ENV === 'development') {
                console.log(`║  🧪 Test Page:       http://localhost:${PORT}/test           ║`);
            }
            
            console.log('╚══════════════════════════════════════════════════════════╝');
            console.log('\n📡 EMERGENCY NAMESPACES:');
            console.log('   📊 /dashboard    - Real-time dashboard updates');
            console.log('   📦 /inventory    - Live inventory monitoring');
            console.log('   🔔 /notifications - Emergency notifications');
            console.log('\n🚨 P1 EMERGENCY MODE: Server ready for real-time connections!');
        });

        // Graceful shutdown
        const signals = ['SIGTERM', 'SIGINT', 'SIGUSR2'];
        signals.forEach(signal => {
            process.on(signal, async () => {
                console.log(`\n🛑 P1 EMERGENCY: Received ${signal}. Shutting down...`);
                await emergencyWebSocketService.shutdown();
                httpServer.close(() => {
                    console.log('✅ P1 EMERGENCY: Server shutdown complete');
                    process.exit(0);
                });
            });
        });

    } catch (error) {
        console.error('\n❌ P1 EMERGENCY STARTUP FAILED!');
        console.error('Error:', error.message);
        console.error('\n💡 Troubleshooting:');
        console.error('   1. Check NILEDB connection settings');
        console.error('   2. Verify port', PORT, 'is available');
        console.error('   3. Check environment variables');
        process.exit(1);
    }
}

// Start the emergency server
startEmergencyServer();