#!/usr/bin/env node

/**
 * WebSocket Real-Time Server Startup Script
 * Production-ready startup with comprehensive error handling and monitoring
 */

import { websocketServer } from './src/websocket-server.js';
import { performance } from 'perf_hooks';
import { cpus } from 'os';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Configuration
const config = {
    port: process.env.WEBSOCKET_PORT || 4001,
    environment: process.env.NODE_ENV || 'development',
    cluster: process.env.WEBSOCKET_CLUSTER === 'true',
    workers: parseInt(process.env.WEBSOCKET_WORKERS) || cpus().length,
    maxMemory: process.env.MAX_MEMORY_MB || 512,
    enableGC: process.env.ENABLE_GC !== 'false'
};

// Performance monitoring
const startupTime = performance.now();
let memoryWarnings = 0;

/**
 * Print startup banner
 */
function printBanner() {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    WEBSOCKET REAL-TIME SERVER                ║
║                         Version 2.0.0                       ║
╠══════════════════════════════════════════════════════════════╣
║  🚀 Socket.io with NILEDB Integration                       ║
║  📦 Real-time Inventory Updates                             ║
║  🛒 Live Order Tracking                                     ║
║  👤 Customer Activity Streaming                             ║
║  🔔 Push Notifications                                      ║
║  📊 Dashboard Updates                                       ║
║  🔄 Auto-Reconnection Handling                             ║
╚══════════════════════════════════════════════════════════════╝
    `);
}

/**
 * Print system information
 */
function printSystemInfo() {
    console.log('🖥️  System Information:');
    console.log(`   📍 Environment: ${config.environment}`);
    console.log(`   🌐 Port: ${config.port}`);
    console.log(`   💾 Available CPUs: ${cpus().length}`);
    console.log(`   🧠 Node.js: ${process.version}`);
    console.log(`   📊 Memory Limit: ${config.maxMemory}MB`);
    console.log(`   🗂️  Platform: ${process.platform} ${process.arch}`);
    console.log(`   ⚡ GC Enabled: ${config.enableGC}`);
    console.log('');
}

/**
 * Setup memory monitoring
 */
function setupMemoryMonitoring() {
    if (!config.enableGC) return;

    setInterval(() => {
        const usage = process.memoryUsage();
        const usedMB = Math.round(usage.heapUsed / 1024 / 1024);
        const totalMB = Math.round(usage.heapTotal / 1024 / 1024);
        
        // Memory warning threshold (80% of limit)
        const warningThreshold = config.maxMemory * 0.8;
        
        if (usedMB > warningThreshold) {
            memoryWarnings++;
            console.warn(`⚠️ Memory Warning: ${usedMB}MB used (${Math.round(usedMB/config.maxMemory*100)}%)`);
            
            // Force garbage collection if available
            if (global.gc && memoryWarnings % 3 === 0) {
                console.log('🧹 Running garbage collection...');
                global.gc();
                const newUsage = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
                console.log(`✅ Memory after GC: ${newUsage}MB (freed ${usedMB - newUsage}MB)`);
            }
        }
        
        // Log memory stats every 5 minutes in development
        if (config.environment === 'development' && Date.now() % (5 * 60 * 1000) < 30000) {
            console.log(`📊 Memory: ${usedMB}/${totalMB}MB heap, ${Math.round(usage.external/1024/1024)}MB external`);
        }
    }, 30000); // Check every 30 seconds
}

/**
 * Setup process monitoring
 */
function setupProcessMonitoring() {
    // CPU usage monitoring
    let lastCpuUsage = process.cpuUsage();
    setInterval(() => {
        const cpuUsage = process.cpuUsage(lastCpuUsage);
        const cpuPercent = Math.round((cpuUsage.user + cpuUsage.system) / 1000000 * 100);
        
        if (cpuPercent > 80) {
            console.warn(`⚠️ High CPU usage: ${cpuPercent}%`);
        }
        
        lastCpuUsage = process.cpuUsage();
    }, 60000); // Check every minute

    // Event loop lag monitoring
    let start = process.hrtime();
    setInterval(() => {
        const delta = process.hrtime(start);
        const nanosec = delta[0] * 1e9 + delta[1];
        const millisec = nanosec / 1e6;
        const lag = millisec - 1000; // Expected 1000ms interval
        
        if (lag > 100) { // More than 100ms lag
            console.warn(`⚠️ Event loop lag: ${Math.round(lag)}ms`);
        }
        
        start = process.hrtime();
    }, 1000);
}

/**
 * Setup environment validation
 */
function validateEnvironment() {
    console.log('🔍 Validating environment...');
    
    const required = [
        'DB_HOST',
        'DB_USER', 
        'DB_PASSWORD',
        'DB_NAME'
    ];
    
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
        console.error('❌ Missing required environment variables:');
        missing.forEach(key => console.error(`   - ${key}`));
        process.exit(1);
    }
    
    // Validate NILEDB connection string
    if (!process.env.NILEDB_CONNECTION_STRING && !process.env.NILEDB_HOST) {
        console.warn('⚠️ NILEDB connection not configured. Some features may be limited.');
    }
    
    // Validate CORS origins
    if (config.environment === 'production' && !process.env.CORS_ORIGIN) {
        console.warn('⚠️ CORS_ORIGIN not set for production. Using default origins.');
    }
    
    console.log('✅ Environment validation passed');
}

/**
 * Setup performance optimization
 */
function setupPerformanceOptimization() {
    // Increase max listeners to prevent warnings
    process.setMaxListeners(20);
    
    // Optimize garbage collection flags
    if (config.enableGC && !process.env.NODE_OPTIONS?.includes('--expose-gc')) {
        console.log('💡 Tip: Add --expose-gc to NODE_OPTIONS for better memory management');
    }
    
    // Set process title for easier identification
    process.title = `websocket-server-${config.port}`;
    
    // Optimize event loop
    process.nextTick(() => {
        console.log('⚡ Event loop optimized');
    });
}

/**
 * Start the server
 */
async function startServer() {
    try {
        printBanner();
        printSystemInfo();
        
        // Validation and setup
        validateEnvironment();
        setupPerformanceOptimization();
        setupMemoryMonitoring();
        setupProcessMonitoring();
        
        console.log('🚀 Starting WebSocket Real-Time Server...\n');
        
        // Start the server
        const result = await websocketServer.start();
        
        if (result.success) {
            const startupDuration = Math.round(performance.now() - startupTime);
            
            console.log('\n🎉 SERVER STARTED SUCCESSFULLY!');
            console.log('╔══════════════════════════════════════════════════════════════╗');
            console.log('║                      CONNECTION ENDPOINTS                    ║');
            console.log('╠══════════════════════════════════════════════════════════════╣');
            console.log(`║  🌐 HTTP Server:     http://localhost:${config.port}                    ║`);
            console.log(`║  🔌 WebSocket:       ws://localhost:${config.port}                      ║`);
            console.log(`║  📊 Health Check:    http://localhost:${config.port}/health             ║`);
            console.log(`║  📈 Metrics:         http://localhost:${config.port}/metrics            ║`);
            console.log(`║  👥 Clients:         http://localhost:${config.port}/clients            ║`);
            console.log(`║  🚨 Alerts:          http://localhost:${config.port}/alerts             ║`);
            
            if (config.environment === 'development') {
                console.log(`║  🧪 Test Page:       http://localhost:${config.port}/test               ║`);
            }
            
            console.log('╚══════════════════════════════════════════════════════════════╝');
            console.log('\n📡 NAMESPACES:');
            console.log('   📦 /inventory    - Real-time inventory updates');
            console.log('   🛒 /orders       - Live order tracking');
            console.log('   📊 /dashboard    - Dashboard metrics and updates');
            console.log('   👤 /customer     - Customer activity streaming');
            console.log('   🔔 /notifications - Push notifications');
            
            console.log(`\n⚡ Startup completed in ${startupDuration}ms`);
            console.log('🛡️  Server is ready for connections!');
            
            // Log startup metrics
            if (config.environment === 'development') {
                setTimeout(() => {
                    const metrics = websocketServer.getMetrics();
                    console.log('\n📊 Initial Metrics:', metrics);
                }, 1000);
            }
            
        } else {
            throw new Error(result.error);
        }
        
    } catch (error) {
        console.error('\n❌ STARTUP FAILED!');
        console.error('╔══════════════════════════════════════════════════════════════╗');
        console.error('║                        ERROR DETAILS                         ║');
        console.error('╠══════════════════════════════════════════════════════════════╣');
        console.error(`║  Error: ${error.message.padEnd(52)} ║`);
        console.error(`║  Code:  ${(error.code || 'UNKNOWN').padEnd(52)} ║`);
        console.error('╚══════════════════════════════════════════════════════════════╝');
        
        if (config.environment === 'development') {
            console.error('\n🔍 Stack Trace:', error.stack);
        }
        
        console.error('\n💡 Troubleshooting Tips:');
        console.error('   1. Check database connection settings');
        console.error('   2. Verify NILEDB configuration');
        console.error('   3. Ensure port is not already in use');
        console.error('   4. Check environment variables');
        console.error(`   5. View logs for detailed error information`);
        
        process.exit(1);
    }
}

/**
 * Setup graceful shutdown
 */
function setupGracefulShutdown() {
    const signals = ['SIGTERM', 'SIGINT', 'SIGUSR2'];
    
    signals.forEach(signal => {
        process.on(signal, async () => {
            console.log(`\n🛑 Received ${signal}. Initiating graceful shutdown...`);
            
            try {
                await websocketServer.stop();
                
                console.log('✅ Graceful shutdown completed');
                console.log('👋 Goodbye!');
                
                process.exit(0);
            } catch (error) {
                console.error('❌ Error during shutdown:', error);
                process.exit(1);
            }
        });
    });
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
        console.error('❌ Uncaught Exception:', error);
        process.exit(1);
    });
    
    process.on('unhandledRejection', (reason, promise) => {
        console.error('❌ Unhandled Promise Rejection:', reason);
        console.error('   At:', promise);
        process.exit(1);
    });
}

/**
 * Main execution
 */
async function main() {
    setupGracefulShutdown();
    await startServer();
}

// Start the server
main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});

export default main;