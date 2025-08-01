/**
 * NILEDB Real-Time Integration Service
 * Handles real-time data operations with NILEDB for WebSocket service
 * 
 * Features:
 * - Real-time inventory monitoring
 * - Order status tracking
 * - Customer activity streaming
 * - Performance metrics collection
 * - Data change detection
 * - Automated alerts and notifications
 */

import { 
    nileDb, 
    nilePool,
    testNileConnection,
    insertDashboardMetric,
    insertDashboardEvent,
    getDashboardMetrics,
    getDashboardEvents,
    storeRealTimeData,
    getRealTimeData,
    cleanupExpiredData
} from '../config/niledb.config.js';
import { EventEmitter } from 'events';

class NileDBRealTimeService extends EventEmitter {
    constructor() {
        super();
        this.isInitialized = false;
        this.pollingIntervals = new Map();
        this.changeDetectors = new Map();
        this.lastKnownStates = new Map();
        this.alertThresholds = new Map();
        
        // Performance metrics
        this.metrics = {
            queriesExecuted: 0,
            errorsOccurred: 0,
            changesDetected: 0,
            alertsTriggered: 0,
            dataPointsStored: 0,
            averageQueryTime: 0,
            lastHealthCheck: null,
            connectionHealth: 'unknown'
        };

        // Default alert thresholds
        this.setupDefaultThresholds();
    }

    /**
     * Initialize NILEDB real-time service
     */
    async initialize() {
        try {
            console.log('🚀 Initializing NILEDB Real-Time Service...');
            
            // Test connection
            const connectionTest = await testNileConnection();
            if (!connectionTest.success) {
                throw new Error(`NILEDB connection failed: ${connectionTest.error}`);
            }

            this.metrics.connectionHealth = 'healthy';
            this.metrics.lastHealthCheck = new Date();
            
            // Initialize database objects for real-time tracking
            await this.initializeTrackingTables();
            
            // Setup change detection
            this.setupChangeDetection();
            
            // Start health monitoring
            this.startHealthMonitoring();
            
            // Start cleanup processes
            this.startCleanupProcesses();
            
            this.isInitialized = true;
            console.log('✅ NILEDB Real-Time Service initialized successfully');
            
            // Log initialization
            await insertDashboardEvent('niledb_realtime_initialized', {
                timestamp: new Date().toISOString(),
                connectionHealth: this.metrics.connectionHealth
            }, 'system', 'info');
            
            this.emit('service:initialized');
            return { success: true };
        } catch (error) {
            console.error('❌ Failed to initialize NILEDB Real-Time Service:', error);
            this.metrics.connectionHealth = 'failed';
            this.metrics.errorsOccurred++;
            this.emit('service:error', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Initialize tracking tables in NILEDB
     */
    async initializeTrackingTables() {
        const client = await nilePool.connect();
        try {
            // Inventory change tracking
            await client.query(`
                CREATE TABLE IF NOT EXISTS inventory_change_log (
                    id SERIAL PRIMARY KEY,
                    product_id VARCHAR(100),
                    warehouse_id VARCHAR(100),
                    old_quantity INTEGER,
                    new_quantity INTEGER,
                    change_type VARCHAR(50),
                    change_reason VARCHAR(100),
                    detected_at TIMESTAMP DEFAULT NOW(),
                    processed BOOLEAN DEFAULT FALSE,
                    metadata JSONB DEFAULT '{}'
                )
            `);

            // Order status tracking
            await client.query(`
                CREATE TABLE IF NOT EXISTS order_status_log (
                    id SERIAL PRIMARY KEY,
                    order_id VARCHAR(100),
                    customer_id VARCHAR(100),
                    old_status VARCHAR(50),
                    new_status VARCHAR(50),
                    status_change_reason VARCHAR(100),
                    detected_at TIMESTAMP DEFAULT NOW(),
                    processed BOOLEAN DEFAULT FALSE,
                    metadata JSONB DEFAULT '{}'
                )
            `);

            // Customer activity tracking
            await client.query(`
                CREATE TABLE IF NOT EXISTS customer_activity_log (
                    id SERIAL PRIMARY KEY,
                    customer_id VARCHAR(100),
                    activity_type VARCHAR(100),
                    activity_data JSONB,
                    detected_at TIMESTAMP DEFAULT NOW(),
                    processed BOOLEAN DEFAULT FALSE,
                    session_id VARCHAR(100),
                    metadata JSONB DEFAULT '{}'
                )
            `);

            // Alert management
            await client.query(`
                CREATE TABLE IF NOT EXISTS realtime_alerts (
                    id SERIAL PRIMARY KEY,
                    alert_type VARCHAR(100),
                    severity VARCHAR(20) DEFAULT 'medium',
                    title VARCHAR(200),
                    message TEXT,
                    data JSONB,
                    triggered_at TIMESTAMP DEFAULT NOW(),
                    acknowledged BOOLEAN DEFAULT FALSE,
                    acknowledged_by VARCHAR(100),
                    acknowledged_at TIMESTAMP,
                    expires_at TIMESTAMP DEFAULT (NOW() + INTERVAL '24 hours')
                )
            `);

            // System health tracking
            await client.query(`
                CREATE TABLE IF NOT EXISTS system_health_log (
                    id SERIAL PRIMARY KEY,
                    service_name VARCHAR(100),
                    health_status VARCHAR(50),
                    metrics JSONB,
                    checked_at TIMESTAMP DEFAULT NOW(),
                    response_time_ms DECIMAL(10,3)
                )
            `);

            // Create indexes for performance
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_inventory_change_log_product_time 
                ON inventory_change_log (product_id, detected_at DESC)
            `);
            
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_order_status_log_order_time 
                ON order_status_log (order_id, detected_at DESC)
            `);
            
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_customer_activity_customer_time 
                ON customer_activity_log (customer_id, detected_at DESC)
            `);

            console.log('✅ NILEDB tracking tables initialized');
        } finally {
            client.release();
        }
    }

    /**
     * Setup default alert thresholds
     */
    setupDefaultThresholds() {
        this.alertThresholds.set('low_stock', { threshold: 10, severity: 'high' });
        this.alertThresholds.set('out_of_stock', { threshold: 0, severity: 'critical' });
        this.alertThresholds.set('high_order_volume', { threshold: 100, severity: 'medium' });
        this.alertThresholds.set('system_error_rate', { threshold: 0.05, severity: 'high' });
        this.alertThresholds.set('slow_query', { threshold: 1000, severity: 'medium' });
        this.alertThresholds.set('connection_failure', { threshold: 1, severity: 'critical' });
    }

    /**
     * Setup change detection for real-time monitoring
     */
    setupChangeDetection() {
        // Inventory change detection - every 5 seconds
        this.startChangeDetection('inventory', async () => {
            return await this.detectInventoryChanges();
        }, 5000);

        // Order status change detection - every 10 seconds
        this.startChangeDetection('orders', async () => {
            return await this.detectOrderStatusChanges();
        }, 10000);

        // Customer activity detection - every 15 seconds
        this.startChangeDetection('customer_activity', async () => {
            return await this.detectCustomerActivityChanges();
        }, 15000);

        // System performance monitoring - every 30 seconds
        this.startChangeDetection('system_performance', async () => {
            return await this.monitorSystemPerformance();
        }, 30000);
    }

    /**
     * Start change detection for a specific data type
     */
    startChangeDetection(dataType, detectionFunction, interval) {
        if (this.pollingIntervals.has(dataType)) {
            clearInterval(this.pollingIntervals.get(dataType));
        }

        const intervalId = setInterval(async () => {
            try {
                const changes = await detectionFunction();
                if (changes && changes.length > 0) {
                    this.metrics.changesDetected += changes.length;
                    this.emit('changes:detected', { dataType, changes });
                    
                    // Process each change
                    for (const change of changes) {
                        await this.processChange(dataType, change);
                    }
                }
            } catch (error) {
                console.error(`Change detection error for ${dataType}:`, error);
                this.metrics.errorsOccurred++;
                this.emit('detection:error', { dataType, error });
            }
        }, interval);

        this.pollingIntervals.set(dataType, intervalId);
        console.log(`✅ Change detection started for ${dataType} (${interval}ms interval)`);
    }

    /**
     * Detect inventory changes
     */
    async detectInventoryChanges() {
        const client = await nilePool.connect();
        try {
            const startTime = Date.now();
            
            // This is a mock query - replace with actual inventory monitoring query
            const result = await client.query(`
                SELECT 
                    'MOCK_PRODUCT_' || generate_series(1,3) as product_id,
                    'WAREHOUSE_' || (random() * 5)::int as warehouse_id,
                    (random() * 100)::int as current_quantity,
                    CASE 
                        WHEN random() < 0.3 THEN 'low_stock'
                        WHEN random() < 0.1 THEN 'out_of_stock'
                        ELSE 'normal'
                    END as stock_status,
                    NOW() as last_updated
                WHERE random() < 0.2
            `);

            const queryTime = Date.now() - startTime;
            this.updateQueryMetrics(queryTime);

            const changes = [];
            for (const row of result.rows) {
                const stateKey = `inventory:${row.product_id}:${row.warehouse_id}`;
                const lastState = this.lastKnownStates.get(stateKey);
                
                if (!lastState || lastState.current_quantity !== row.current_quantity) {
                    const change = {
                        product_id: row.product_id,
                        warehouse_id: row.warehouse_id,
                        old_quantity: lastState?.current_quantity || 0,
                        new_quantity: row.current_quantity,
                        stock_status: row.stock_status,
                        change_type: this.determineChangeType(lastState?.current_quantity, row.current_quantity),
                        detected_at: new Date().toISOString()
                    };
                    
                    changes.push(change);
                    this.lastKnownStates.set(stateKey, row);
                    
                    // Log change to database
                    await this.logInventoryChange(change);
                    
                    // Check for alerts
                    await this.checkInventoryAlerts(change);
                }
            }

            return changes;
        } finally {
            client.release();
        }
    }

    /**
     * Detect order status changes
     */
    async detectOrderStatusChanges() {
        const client = await nilePool.connect();
        try {
            const startTime = Date.now();
            
            // Mock query - replace with actual order monitoring
            const result = await client.query(`
                SELECT 
                    'ORDER_' || generate_series(1,5) as order_id,
                    'CUSTOMER_' || (random() * 20)::int as customer_id,
                    CASE (random() * 5)::int
                        WHEN 0 THEN 'pending'
                        WHEN 1 THEN 'processing'
                        WHEN 2 THEN 'shipped'
                        WHEN 3 THEN 'delivered'
                        ELSE 'cancelled'
                    END as current_status,
                    NOW() as last_updated
                WHERE random() < 0.15
            `);

            const queryTime = Date.now() - startTime;
            this.updateQueryMetrics(queryTime);

            const changes = [];
            for (const row of result.rows) {
                const stateKey = `order:${row.order_id}`;
                const lastState = this.lastKnownStates.get(stateKey);
                
                if (!lastState || lastState.current_status !== row.current_status) {
                    const change = {
                        order_id: row.order_id,
                        customer_id: row.customer_id,
                        old_status: lastState?.current_status || 'unknown',
                        new_status: row.current_status,
                        status_change_reason: 'system_update',
                        detected_at: new Date().toISOString()
                    };
                    
                    changes.push(change);
                    this.lastKnownStates.set(stateKey, row);
                    
                    // Log change to database
                    await this.logOrderStatusChange(change);
                    
                    // Check for alerts
                    await this.checkOrderAlerts(change);
                }
            }

            return changes;
        } finally {
            client.release();
        }
    }

    /**
     * Detect customer activity changes
     */
    async detectCustomerActivityChanges() {
        const client = await nilePool.connect();
        try {
            const startTime = Date.now();
            
            // Mock query - replace with actual customer activity monitoring
            const result = await client.query(`
                SELECT 
                    'CUSTOMER_' || (random() * 50)::int as customer_id,
                    CASE (random() * 4)::int
                        WHEN 0 THEN 'login'
                        WHEN 1 THEN 'purchase'
                        WHEN 2 THEN 'browse'
                        ELSE 'logout'
                    END as activity_type,
                    jsonb_build_object(
                        'timestamp', NOW(),
                        'value', (random() * 1000)::int,
                        'session_duration', (random() * 3600)::int
                    ) as activity_data,
                    NOW() as detected_at
                WHERE random() < 0.1
            `);

            const queryTime = Date.now() - startTime;
            this.updateQueryMetrics(queryTime);

            const activities = [];
            for (const row of result.rows) {
                const activity = {
                    customer_id: row.customer_id,
                    activity_type: row.activity_type,
                    activity_data: row.activity_data,
                    detected_at: new Date().toISOString(),
                    session_id: `session_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`
                };
                
                activities.push(activity);
                
                // Log activity to database
                await this.logCustomerActivity(activity);
            }

            return activities;
        } finally {
            client.release();
        }
    }

    /**
     * Monitor system performance
     */
    async monitorSystemPerformance() {
        const startTime = Date.now();
        
        try {
            // Test NILEDB connection performance
            const connectionTest = await testNileConnection();
            const responseTime = Date.now() - startTime;
            
            const performanceData = {
                service: 'niledb-realtime',
                connection_healthy: connectionTest.success,
                response_time_ms: responseTime,
                active_connections: nilePool.totalCount,
                idle_connections: nilePool.idleCount,
                waiting_connections: nilePool.waitingCount,
                metrics: {
                    queriesExecuted: this.metrics.queriesExecuted,
                    errorsOccurred: this.metrics.errorsOccurred,
                    changesDetected: this.metrics.changesDetected,
                    alertsTriggered: this.metrics.alertsTriggered,
                    averageQueryTime: this.metrics.averageQueryTime
                },
                timestamp: new Date().toISOString()
            };

            // Log performance data
            await this.logSystemHealth(performanceData);
            
            // Check for performance alerts
            await this.checkPerformanceAlerts(performanceData);
            
            // Update connection health
            this.metrics.connectionHealth = connectionTest.success ? 'healthy' : 'unhealthy';
            this.metrics.lastHealthCheck = new Date();
            
            return [performanceData];
        } catch (error) {
            console.error('System performance monitoring error:', error);
            this.metrics.errorsOccurred++;
            this.metrics.connectionHealth = 'error';
            return [];
        }
    }

    /**
     * Process detected changes
     */
    async processChange(dataType, change) {
        try {
            // Store change in real-time data table
            await storeRealTimeData(`${dataType}_change`, change, 2);
            
            // Emit change event for WebSocket broadcasting
            this.emit('realtime:change', {
                type: dataType,
                change: change,
                timestamp: new Date().toISOString()
            });
            
            console.log(`📡 Change processed: ${dataType}`, change);
        } catch (error) {
            console.error('Change processing error:', error);
            this.metrics.errorsOccurred++;
        }
    }

    /**
     * Log inventory change to database
     */
    async logInventoryChange(change) {
        const client = await nilePool.connect();
        try {
            await client.query(`
                INSERT INTO inventory_change_log 
                (product_id, warehouse_id, old_quantity, new_quantity, change_type, change_reason, detected_at, metadata)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `, [
                change.product_id,
                change.warehouse_id,
                change.old_quantity,
                change.new_quantity,
                change.change_type,
                'system_detection',
                change.detected_at,
                JSON.stringify({ stock_status: change.stock_status })
            ]);
        } finally {
            client.release();
        }
    }

    /**
     * Log order status change to database
     */
    async logOrderStatusChange(change) {
        const client = await nilePool.connect();
        try {
            await client.query(`
                INSERT INTO order_status_log 
                (order_id, customer_id, old_status, new_status, status_change_reason, detected_at)
                VALUES ($1, $2, $3, $4, $5, $6)
            `, [
                change.order_id,
                change.customer_id,
                change.old_status,
                change.new_status,
                change.status_change_reason,
                change.detected_at
            ]);
        } finally {
            client.release();
        }
    }

    /**
     * Log customer activity to database
     */
    async logCustomerActivity(activity) {
        const client = await nilePool.connect();
        try {
            await client.query(`
                INSERT INTO customer_activity_log 
                (customer_id, activity_type, activity_data, detected_at, session_id)
                VALUES ($1, $2, $3, $4, $5)
            `, [
                activity.customer_id,
                activity.activity_type,
                JSON.stringify(activity.activity_data),
                activity.detected_at,
                activity.session_id
            ]);
        } finally {
            client.release();
        }
    }

    /**
     * Log system health data
     */
    async logSystemHealth(healthData) {
        const client = await nilePool.connect();
        try {
            await client.query(`
                INSERT INTO system_health_log 
                (service_name, health_status, metrics, checked_at, response_time_ms)
                VALUES ($1, $2, $3, $4, $5)
            `, [
                healthData.service,
                healthData.connection_healthy ? 'healthy' : 'unhealthy',
                JSON.stringify(healthData.metrics),
                healthData.timestamp,
                healthData.response_time_ms
            ]);
        } finally {
            client.release();
        }
    }

    /**
     * Check inventory alerts
     */
    async checkInventoryAlerts(change) {
        try {
            // Low stock alert
            if (change.new_quantity <= this.alertThresholds.get('low_stock').threshold && 
                change.new_quantity > this.alertThresholds.get('out_of_stock').threshold) {
                await this.triggerAlert('low_stock', 'high', {
                    title: 'Low Stock Alert',
                    message: `Product ${change.product_id} in warehouse ${change.warehouse_id} is running low (${change.new_quantity} remaining)`,
                    data: change
                });
            }
            
            // Out of stock alert
            if (change.new_quantity <= this.alertThresholds.get('out_of_stock').threshold) {
                await this.triggerAlert('out_of_stock', 'critical', {
                    title: 'Out of Stock Alert',
                    message: `Product ${change.product_id} in warehouse ${change.warehouse_id} is out of stock`,
                    data: change
                });
            }
        } catch (error) {
            console.error('Inventory alert check error:', error);
        }
    }

    /**
     * Check order alerts
     */
    async checkOrderAlerts(change) {
        try {
            // Order cancelled alert
            if (change.new_status === 'cancelled') {
                await this.triggerAlert('order_cancelled', 'medium', {
                    title: 'Order Cancelled',
                    message: `Order ${change.order_id} has been cancelled`,
                    data: change
                });
            }
            
            // Order delivered notification
            if (change.new_status === 'delivered') {
                await this.triggerAlert('order_delivered', 'info', {
                    title: 'Order Delivered',
                    message: `Order ${change.order_id} has been delivered to customer ${change.customer_id}`,
                    data: change
                });
            }
        } catch (error) {
            console.error('Order alert check error:', error);
        }
    }

    /**
     * Check performance alerts
     */
    async checkPerformanceAlerts(performanceData) {
        try {
            // Slow query alert
            if (performanceData.response_time_ms > this.alertThresholds.get('slow_query').threshold) {
                await this.triggerAlert('slow_query', 'medium', {
                    title: 'Slow Database Query',
                    message: `Database query took ${performanceData.response_time_ms}ms to complete`,
                    data: performanceData
                });
            }
            
            // Connection failure alert
            if (!performanceData.connection_healthy) {
                await this.triggerAlert('connection_failure', 'critical', {
                    title: 'Database Connection Failure',
                    message: 'NILEDB connection is unhealthy',
                    data: performanceData
                });
            }
            
            // High error rate alert
            const errorRate = this.metrics.errorsOccurred / Math.max(this.metrics.queriesExecuted, 1);
            if (errorRate > this.alertThresholds.get('system_error_rate').threshold) {
                await this.triggerAlert('system_error_rate', 'high', {
                    title: 'High Error Rate',
                    message: `System error rate is ${(errorRate * 100).toFixed(2)}%`,
                    data: { errorRate, metrics: this.metrics }
                });
            }
        } catch (error) {
            console.error('Performance alert check error:', error);
        }
    }

    /**
     * Trigger an alert
     */
    async triggerAlert(alertType, severity, alertData) {
        const client = await nilePool.connect();
        try {
            const result = await client.query(`
                INSERT INTO realtime_alerts 
                (alert_type, severity, title, message, data, triggered_at)
                VALUES ($1, $2, $3, $4, $5, NOW())
                RETURNING id
            `, [
                alertType,
                severity,
                alertData.title,
                alertData.message,
                JSON.stringify(alertData.data)
            ]);

            const alertId = result.rows[0].id;
            this.metrics.alertsTriggered++;

            // Emit alert event
            this.emit('alert:triggered', {
                id: alertId,
                type: alertType,
                severity,
                ...alertData,
                timestamp: new Date().toISOString()
            });

            console.log(`🚨 Alert triggered: ${alertType} (${severity})`, alertData.title);
        } finally {
            client.release();
        }
    }

    /**
     * Health monitoring
     */
    startHealthMonitoring() {
        // Health check every 60 seconds
        setInterval(async () => {
            try {
                const connectionTest = await testNileConnection();
                this.metrics.connectionHealth = connectionTest.success ? 'healthy' : 'unhealthy';
                this.metrics.lastHealthCheck = new Date();
                
                // Store health metric
                await insertDashboardMetric('niledb_connection_health', connectionTest.success ? 1 : 0, 'gauge');
            } catch (error) {
                console.error('Health monitoring error:', error);
                this.metrics.connectionHealth = 'error';
                this.metrics.errorsOccurred++;
            }
        }, 60000);
    }

    /**
     * Start cleanup processes
     */
    startCleanupProcesses() {
        // Clean up expired real-time data every 30 minutes
        setInterval(async () => {
            try {
                await cleanupExpiredData();
                console.log('✅ Expired real-time data cleaned up');
            } catch (error) {
                console.error('Cleanup error:', error);
            }
        }, 30 * 60 * 1000);

        // Clean up old logs every hour
        setInterval(async () => {
            try {
                await this.cleanupOldLogs();
                console.log('✅ Old logs cleaned up');
            } catch (error) {
                console.error('Log cleanup error:', error);
            }
        }, 60 * 60 * 1000);
    }

    /**
     * Clean up old logs
     */
    async cleanupOldLogs() {
        const client = await nilePool.connect();
        try {
            // Clean up logs older than 7 days
            const cutoffDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            
            await client.query(`
                DELETE FROM inventory_change_log 
                WHERE detected_at < $1 AND processed = true
            `, [cutoffDate]);
            
            await client.query(`
                DELETE FROM order_status_log 
                WHERE detected_at < $1 AND processed = true
            `, [cutoffDate]);
            
            await client.query(`
                DELETE FROM customer_activity_log 
                WHERE detected_at < $1 AND processed = true
            `, [cutoffDate]);
            
            await client.query(`
                DELETE FROM system_health_log 
                WHERE checked_at < $1
            `, [cutoffDate]);
            
            // Clean up acknowledged alerts older than 30 days
            const alertCutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            await client.query(`
                DELETE FROM realtime_alerts 
                WHERE triggered_at < $1 AND acknowledged = true
            `, [alertCutoffDate]);
        } finally {
            client.release();
        }
    }

    /**
     * Utility methods
     */
    updateQueryMetrics(queryTime) {
        this.metrics.queriesExecuted++;
        const totalTime = (this.metrics.averageQueryTime * (this.metrics.queriesExecuted - 1)) + queryTime;
        this.metrics.averageQueryTime = totalTime / this.metrics.queriesExecuted;
    }

    determineChangeType(oldQuantity, newQuantity) {
        if (oldQuantity === undefined || oldQuantity === null) return 'initial';
        if (newQuantity > oldQuantity) return 'increase';
        if (newQuantity < oldQuantity) return 'decrease';
        return 'no_change';
    }

    /**
     * Public API methods
     */
    
    /**
     * Get recent changes by type
     */
    async getRecentChanges(dataType, limit = 50) {
        const client = await nilePool.connect();
        try {
            let tableName, result;
            
            switch (dataType) {
                case 'inventory':
                    result = await client.query(`
                        SELECT * FROM inventory_change_log 
                        ORDER BY detected_at DESC 
                        LIMIT $1
                    `, [limit]);
                    break;
                case 'orders':
                    result = await client.query(`
                        SELECT * FROM order_status_log 
                        ORDER BY detected_at DESC 
                        LIMIT $1
                    `, [limit]);
                    break;
                case 'customer_activity':
                    result = await client.query(`
                        SELECT * FROM customer_activity_log 
                        ORDER BY detected_at DESC 
                        LIMIT $1
                    `, [limit]);
                    break;
                default:
                    throw new Error(`Unknown data type: ${dataType}`);
            }
            
            return { success: true, data: result.rows };
        } catch (error) {
            console.error('Get recent changes error:', error);
            return { success: false, error: error.message };
        } finally {
            client.release();
        }
    }

    /**
     * Get active alerts
     */
    async getActiveAlerts(severity = null) {
        const client = await nilePool.connect();
        try {
            let query = `
                SELECT * FROM realtime_alerts 
                WHERE acknowledged = false AND expires_at > NOW()
            `;
            const params = [];
            
            if (severity) {
                query += ` AND severity = $1`;
                params.push(severity);
            }
            
            query += ` ORDER BY triggered_at DESC`;
            
            const result = await client.query(query, params);
            return { success: true, data: result.rows };
        } catch (error) {
            console.error('Get active alerts error:', error);
            return { success: false, error: error.message };
        } finally {
            client.release();
        }
    }

    /**
     * Acknowledge alert
     */
    async acknowledgeAlert(alertId, acknowledgedBy) {
        const client = await nilePool.connect();
        try {
            const result = await client.query(`
                UPDATE realtime_alerts 
                SET acknowledged = true, acknowledged_by = $1, acknowledged_at = NOW()
                WHERE id = $2
                RETURNING *
            `, [acknowledgedBy, alertId]);
            
            if (result.rows.length > 0) {
                this.emit('alert:acknowledged', {
                    alertId,
                    acknowledgedBy,
                    timestamp: new Date().toISOString()
                });
            }
            
            return { success: true, data: result.rows[0] };
        } catch (error) {
            console.error('Acknowledge alert error:', error);
            return { success: false, error: error.message };
        } finally {
            client.release();
        }
    }

    /**
     * Get service metrics
     */
    getMetrics() {
        return {
            ...this.metrics,
            isInitialized: this.isInitialized,
            activeDetectors: this.pollingIntervals.size,
            trackedStates: this.lastKnownStates.size
        };
    }

    /**
     * Update alert thresholds
     */
    updateAlertThreshold(alertType, threshold, severity) {
        this.alertThresholds.set(alertType, { threshold, severity });
        console.log(`✅ Alert threshold updated: ${alertType} = ${threshold} (${severity})`);
    }

    /**
     * Stop all monitoring
     */
    stopMonitoring() {
        for (const [dataType, intervalId] of this.pollingIntervals.entries()) {
            clearInterval(intervalId);
            console.log(`🛑 Stopped monitoring: ${dataType}`);
        }
        this.pollingIntervals.clear();
    }

    /**
     * Shutdown service
     */
    async shutdown() {
        console.log('🛑 Shutting down NILEDB Real-Time Service...');
        
        // Stop all monitoring
        this.stopMonitoring();
        
        // Clear state
        this.lastKnownStates.clear();
        this.changeDetectors.clear();
        
        // Log shutdown
        await insertDashboardEvent('niledb_realtime_shutdown', {
            timestamp: new Date().toISOString(),
            metrics: this.metrics
        }, 'system', 'info');
        
        console.log('✅ NILEDB Real-Time Service shutdown complete');
        this.emit('service:shutdown');
    }
}

// Export singleton instance
export const nileDBRealTimeService = new NileDBRealTimeService();
export default NileDBRealTimeService;