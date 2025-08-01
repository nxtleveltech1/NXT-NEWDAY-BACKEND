/**
 * WebSocket Client Integration Utilities
 * Provides utilities for frontend clients to connect and interact with the WebSocket service
 * 
 * Features:
 * - Connection management with auto-reconnection
 * - Subscription management
 * - Event handling
 * - Authentication integration
 * - Error handling and recovery
 * - TypeScript-like JSDoc annotations for better IDE support
 */

/**
 * @typedef {Object} WebSocketConfig
 * @property {string} url - WebSocket server URL
 * @property {string} [token] - Authentication token
 * @property {boolean} [autoReconnect=true] - Enable auto-reconnection
 * @property {number} [reconnectDelay=1000] - Reconnection delay in ms
 * @property {number} [maxReconnectAttempts=5] - Maximum reconnection attempts
 * @property {Object} [namespaces] - Namespace configuration
 */

/**
 * @typedef {Object} SubscriptionConfig
 * @property {string[]} [productIds] - Product IDs to monitor
 * @property {string[]} [warehouseIds] - Warehouse IDs to monitor
 * @property {string[]} [categories] - Categories to monitor
 * @property {string[]} [orderIds] - Order IDs to track
 * @property {string} [customerId] - Customer ID for activity tracking
 * @property {boolean} [lowStockOnly] - Subscribe to low stock alerts only
 * @property {boolean} [trackingEnabled] - Enable order tracking updates
 */

/**
 * WebSocket Real-Time Client
 * Manages connections to the WebSocket real-time service
 */
class WebSocketRealTimeClient {
    /**
     * @param {WebSocketConfig} config - Client configuration
     */
    constructor(config) {
        this.config = {
            autoReconnect: true,
            reconnectDelay: 1000,
            maxReconnectAttempts: 5,
            namespaces: {
                inventory: '/inventory',
                orders: '/orders',
                dashboard: '/dashboard',
                customer: '/customer',
                notifications: '/notifications'
            },
            ...config
        };

        this.connections = new Map();
        this.subscriptions = new Map();
        this.eventHandlers = new Map();
        this.reconnectAttempts = new Map();
        this.isAuthenticated = false;
        this.clientId = null;
        this.features = [];

        // Bind methods to maintain context
        this.connect = this.connect.bind(this);
        this.disconnect = this.disconnect.bind(this);
        this.subscribe = this.subscribe.bind(this);
        this.unsubscribe = this.unsubscribe.bind(this);
    }

    /**
     * Connect to WebSocket server and all namespaces
     * @returns {Promise<boolean>} Connection success
     */
    async connect() {
        try {
            console.log('🔌 Connecting to WebSocket server...');

            // Connect to main namespace first
            const mainConnection = await this.connectToNamespace('main', '');
            if (!mainConnection) {
                throw new Error('Failed to connect to main namespace');
            }

            // Connect to specialized namespaces
            const namespacePromises = Object.entries(this.config.namespaces).map(
                ([name, path]) => this.connectToNamespace(name, path)
            );

            const results = await Promise.allSettled(namespacePromises);
            const failedConnections = results.filter(result => result.status === 'rejected');
            
            if (failedConnections.length > 0) {
                console.warn(`⚠️ Some namespace connections failed:`, failedConnections);
            }

            console.log('✅ WebSocket client connected successfully');
            this.emit('client:connected', { 
                clientId: this.clientId,
                connectedNamespaces: Array.from(this.connections.keys())
            });

            return true;
        } catch (error) {
            console.error('❌ WebSocket connection failed:', error);
            this.emit('client:error', { error: error.message });
            return false;
        }
    }

    /**
     * Connect to a specific namespace
     * @param {string} name - Namespace name
     * @param {string} path - Namespace path
     * @returns {Promise<boolean>} Connection success
     */
    async connectToNamespace(name, path) {
        return new Promise((resolve, reject) => {
            try {
                // Use socket.io client library (would be imported in actual implementation)
                const socket = io(`${this.config.url}${path}`, {
                    auth: {
                        token: this.config.token
                    },
                    transports: ['polling', 'websocket'],
                    upgrade: true,
                    rememberUpgrade: true
                });

                // Connection established
                socket.on('connect', () => {
                    console.log(`✅ Connected to ${name} namespace`);
                    this.connections.set(name, socket);
                    this.setupNamespaceHandlers(name, socket);
                    this.resetReconnectAttempts(name);
                    resolve(true);
                });

                // Connection error
                socket.on('connect_error', (error) => {
                    console.error(`❌ Connection error for ${name}:`, error);
                    this.handleConnectionError(name, error);
                    reject(error);
                });

                // Disconnection
                socket.on('disconnect', (reason) => {
                    console.warn(`🔌 Disconnected from ${name}:`, reason);
                    this.handleDisconnection(name, reason);
                });

                // Authentication success
                socket.on('connection:established', (data) => {
                    if (name === 'main') {
                        this.clientId = data.clientId;
                        this.isAuthenticated = data.authenticated;
                        this.features = data.features || [];
                        console.log(`🎯 Client established:`, data);
                    }
                });

                // Store socket reference for timeout handling
                setTimeout(() => {
                    if (!this.connections.has(name)) {
                        socket.disconnect();
                        reject(new Error(`Connection timeout for ${name}`));
                    }
                }, 10000); // 10 second timeout

            } catch (error) {
                console.error(`Connection setup error for ${name}:`, error);
                reject(error);
            }
        });
    }

    /**
     * Setup event handlers for a namespace
     * @param {string} name - Namespace name
     * @param {Object} socket - Socket.io socket instance
     */
    setupNamespaceHandlers(name, socket) {
        // Generic message handling
        socket.onAny((eventName, ...args) => {
            this.emit(`${name}:${eventName}`, ...args);
        });

        // Namespace-specific handlers
        switch (name) {
            case 'inventory':
                this.setupInventoryHandlers(socket);
                break;
            case 'orders':
                this.setupOrderHandlers(socket);
                break;
            case 'dashboard':
                this.setupDashboardHandlers(socket);
                break;
            case 'customer':
                this.setupCustomerHandlers(socket);
                break;
            case 'notifications':
                this.setupNotificationHandlers(socket);
                break;
        }

        // Common handlers
        socket.on('error', (error) => {
            console.error(`Socket error in ${name}:`, error);
            this.emit('error', { namespace: name, error });
        });

        socket.on('reconnect', (attemptNumber) => {
            console.log(`🔄 Reconnected to ${name} after ${attemptNumber} attempts`);
            this.emit('reconnected', { namespace: name, attempts: attemptNumber });
        });
    }

    /**
     * Setup inventory-specific event handlers
     * @param {Object} socket - Socket instance
     */
    setupInventoryHandlers(socket) {
        socket.on('inventory:update', (data) => {
            console.log('📦 Inventory update received:', data);
            this.emit('inventory:update', data);
        });

        socket.on('inventory:low-stock', (data) => {
            console.warn('⚠️ Low stock alert:', data);
            this.emit('inventory:low-stock', data);
        });

        socket.on('inventory:data', (data) => {
            this.emit('inventory:data', data);
        });

        socket.on('inventory:subscribed', (data) => {
            console.log('✅ Inventory subscription confirmed:', data);
            this.emit('inventory:subscribed', data);
        });

        socket.on('inventory:error', (error) => {
            console.error('❌ Inventory error:', error);
            this.emit('inventory:error', error);
        });
    }

    /**
     * Setup order-specific event handlers
     * @param {Object} socket - Socket instance
     */
    setupOrderHandlers(socket) {
        socket.on('order:update', (data) => {
            console.log('🛒 Order update received:', data);
            this.emit('order:update', data);
        });

        socket.on('order:tracking', (data) => {
            console.log('📍 Order tracking update:', data);
            this.emit('order:tracking', data);
        });

        socket.on('orders:subscribed', (data) => {
            console.log('✅ Order subscription confirmed:', data);
            this.emit('orders:subscribed', data);
        });

        socket.on('orders:error', (error) => {
            console.error('❌ Order error:', error);
            this.emit('orders:error', error);
        });
    }

    /**
     * Setup dashboard-specific event handlers
     * @param {Object} socket - Socket instance
     */
    setupDashboardHandlers(socket) {
        socket.on('dashboard:data', (data) => {
            console.log('📊 Dashboard data received:', data);
            this.emit('dashboard:data', data);
        });

        socket.on('dashboard:metrics', (data) => {
            this.emit('dashboard:metrics', data);
        });

        socket.on('dashboard:metrics:live', (data) => {
            this.emit('dashboard:metrics:live', data);
        });

        socket.on('dashboard:subscribed', (data) => {
            console.log('✅ Dashboard subscription confirmed:', data);
            this.emit('dashboard:subscribed', data);
        });

        socket.on('dashboard:error', (error) => {
            console.error('❌ Dashboard error:', error);
            this.emit('dashboard:error', error);
        });
    }

    /**
     * Setup customer-specific event handlers
     * @param {Object} socket - Socket instance
     */
    setupCustomerHandlers(socket) {
        socket.on('customer:activity', (data) => {
            console.log('👤 Customer activity:', data);
            this.emit('customer:activity', data);
        });

        socket.on('customer:activity-history', (data) => {
            this.emit('customer:activity-history', data);
        });

        socket.on('customer:subscribed', (data) => {
            console.log('✅ Customer subscription confirmed:', data);
            this.emit('customer:subscribed', data);
        });

        socket.on('customer:error', (error) => {
            console.error('❌ Customer error:', error);
            this.emit('customer:error', error);
        });
    }

    /**
     * Setup notification-specific event handlers
     * @param {Object} socket - Socket instance
     */
    setupNotificationHandlers(socket) {
        socket.on('notification', (data) => {
            console.log(`🔔 Notification (${data.priority}):`, data.message);
            this.emit('notification', data);
        });

        socket.on('notifications:subscribed', (data) => {
            console.log('✅ Notification subscription confirmed:', data);
            this.emit('notifications:subscribed', data);
        });

        socket.on('notifications:error', (error) => {
            console.error('❌ Notification error:', error);
            this.emit('notifications:error', error);
        });
    }

    /**
     * Subscribe to inventory updates
     * @param {SubscriptionConfig} config - Subscription configuration
     * @returns {Promise<boolean>} Subscription success
     */
    async subscribeToInventory(config) {
        const socket = this.connections.get('inventory');
        if (!socket) {
            throw new Error('Inventory namespace not connected');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Inventory subscription timeout'));
            }, 5000);

            socket.once('inventory:subscribed', (data) => {
                clearTimeout(timeout);
                this.subscriptions.set('inventory', config);
                console.log('✅ Subscribed to inventory updates:', data);
                resolve(true);
            });

            socket.once('inventory:error', (error) => {
                clearTimeout(timeout);
                reject(new Error(`Inventory subscription failed: ${error.error}`));
            });

            socket.emit('inventory:subscribe', {
                productIds: config.productIds,
                warehouseIds: config.warehouseIds,
                categories: config.categories,
                lowStockOnly: config.lowStockOnly || false
            });
        });
    }

    /**
     * Subscribe to order updates
     * @param {SubscriptionConfig} config - Subscription configuration
     * @returns {Promise<boolean>} Subscription success
     */
    async subscribeToOrders(config) {
        const socket = this.connections.get('orders');
        if (!socket) {
            throw new Error('Orders namespace not connected');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Order subscription timeout'));
            }, 5000);

            socket.once('orders:subscribed', (data) => {
                clearTimeout(timeout);
                this.subscriptions.set('orders', config);
                console.log('✅ Subscribed to order updates:', data);
                resolve(true);
            });

            socket.once('orders:error', (error) => {
                clearTimeout(timeout);
                reject(new Error(`Order subscription failed: ${error.error}`));
            });

            socket.emit('orders:subscribe', {
                orderIds: config.orderIds,
                customerId: config.customerId,
                status: config.status,
                trackingEnabled: config.trackingEnabled || false
            });
        });
    }

    /**
     * Subscribe to dashboard updates
     * @param {string} dashboardId - Dashboard ID
     * @param {string[]} widgets - Widget types to monitor
     * @param {number} [metricsInterval] - Metrics update interval in ms
     * @returns {Promise<boolean>} Subscription success
     */
    async subscribeToDashboard(dashboardId, widgets = [], metricsInterval = null) {
        const socket = this.connections.get('dashboard');
        if (!socket) {
            throw new Error('Dashboard namespace not connected');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Dashboard subscription timeout'));
            }, 5000);

            socket.once('dashboard:subscribed', (data) => {
                clearTimeout(timeout);
                this.subscriptions.set('dashboard', { dashboardId, widgets, metricsInterval });
                console.log('✅ Subscribed to dashboard updates:', data);
                resolve(true);
            });

            socket.once('dashboard:error', (error) => {
                clearTimeout(timeout);
                reject(new Error(`Dashboard subscription failed: ${error.error}`));
            });

            socket.emit('dashboard:subscribe', {
                dashboardId,
                widgets,
                metricsInterval
            });
        });
    }

    /**
     * Subscribe to customer activity
     * @param {SubscriptionConfig} config - Subscription configuration
     * @returns {Promise<boolean>} Subscription success
     */
    async subscribeToCustomerActivity(config) {
        const socket = this.connections.get('customer');
        if (!socket) {
            throw new Error('Customer namespace not connected');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Customer subscription timeout'));
            }, 5000);

            socket.once('customer:subscribed', (data) => {
                clearTimeout(timeout);
                this.subscriptions.set('customer', config);
                console.log('✅ Subscribed to customer activity:', data);
                resolve(true);
            });

            socket.once('customer:error', (error) => {
                clearTimeout(timeout);
                reject(new Error(`Customer subscription failed: ${error.error}`));
            });

            socket.emit('customer:subscribe', {
                customerId: config.customerId,
                activityTypes: config.activityTypes,
                realtimeTracking: config.realtimeTracking || false
            });
        });
    }

    /**
     * Subscribe to notifications
     * @param {string[]} types - Notification types
     * @param {string} [priority] - Priority filter
     * @returns {Promise<boolean>} Subscription success
     */
    async subscribeToNotifications(types = [], priority = null) {
        const socket = this.connections.get('notifications');
        if (!socket) {
            throw new Error('Notifications namespace not connected');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Notification subscription timeout'));
            }, 5000);

            socket.once('notifications:subscribed', (data) => {
                clearTimeout(timeout);
                this.subscriptions.set('notifications', { types, priority });
                console.log('✅ Subscribed to notifications:', data);
                resolve(true);
            });

            socket.once('notifications:error', (error) => {
                clearTimeout(timeout);
                reject(new Error(`Notification subscription failed: ${error.error}`));
            });

            socket.emit('notifications:subscribe', {
                types,
                priority
            });
        });
    }

    /**
     * Request real-time data
     * @param {string} dataType - Type of data to request
     * @param {Object} parameters - Request parameters
     * @returns {Promise<Object>} Data response
     */
    async requestData(dataType, parameters = {}) {
        const socket = this.connections.get('main');
        if (!socket) {
            throw new Error('Main connection not available');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Data request timeout'));
            }, 10000);

            socket.once('data:response', (response) => {
                clearTimeout(timeout);
                if (response.dataType === dataType) {
                    resolve(response);
                }
            });

            socket.once('data:error', (error) => {
                clearTimeout(timeout);
                if (error.dataType === dataType) {
                    reject(new Error(error.error));
                }
            });

            socket.emit('data:request', {
                dataType,
                parameters,
                timestamp: new Date().toISOString()
            });
        });
    }

    /**
     * Track specific order
     * @param {string} orderId - Order ID to track
     * @returns {Promise<Object>} Tracking data
     */
    async trackOrder(orderId) {
        const socket = this.connections.get('orders');
        if (!socket) {
            throw new Error('Orders namespace not connected');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Order tracking request timeout'));
            }, 5000);

            socket.once('orders:tracking', (response) => {
                clearTimeout(timeout);
                if (response.orderId === orderId) {
                    resolve(response);
                }
            });

            socket.once('orders:error', (error) => {
                clearTimeout(timeout);
                reject(new Error(error.error));
            });

            socket.emit('orders:track', { orderId });
        });
    }

    /**
     * Get current inventory data
     * @param {Object} filters - Inventory filters
     * @returns {Promise<Object>} Inventory data
     */
    async getCurrentInventory(filters = {}) {
        const socket = this.connections.get('inventory');
        if (!socket) {
            throw new Error('Inventory namespace not connected');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Inventory request timeout'));
            }, 5000);

            socket.once('inventory:data', (response) => {
                clearTimeout(timeout);
                resolve(response);
            });

            socket.once('inventory:error', (error) => {
                clearTimeout(timeout);
                reject(new Error(error.error));
            });

            socket.emit('inventory:get-current', filters);
        });
    }

    /**
     * Handle connection errors and implement reconnection logic
     * @param {string} namespace - Namespace name
     * @param {Error} error - Connection error
     */
    handleConnectionError(namespace, error) {
        console.error(`Connection error for ${namespace}:`, error);
        
        if (this.config.autoReconnect) {
            const attempts = this.reconnectAttempts.get(namespace) || 0;
            
            if (attempts < this.config.maxReconnectAttempts) {
                this.reconnectAttempts.set(namespace, attempts + 1);
                
                setTimeout(() => {
                    console.log(`🔄 Attempting to reconnect ${namespace} (${attempts + 1}/${this.config.maxReconnectAttempts})`);
                    this.connectToNamespace(namespace, this.config.namespaces[namespace] || '');
                }, this.config.reconnectDelay * Math.pow(2, attempts)); // Exponential backoff
            } else {
                console.error(`❌ Max reconnection attempts reached for ${namespace}`);
                this.emit('reconnect:failed', { namespace, error });
            }
        }
    }

    /**
     * Handle disconnection
     * @param {string} namespace - Namespace name
     * @param {string} reason - Disconnection reason
     */
    handleDisconnection(namespace, reason) {
        console.warn(`Disconnected from ${namespace}: ${reason}`);
        this.connections.delete(namespace);
        this.emit('disconnected', { namespace, reason });
        
        if (this.config.autoReconnect && reason !== 'io client disconnect') {
            this.handleConnectionError(namespace, new Error(reason));
        }
    }

    /**
     * Reset reconnection attempts for a namespace
     * @param {string} namespace - Namespace name
     */
    resetReconnectAttempts(namespace) {
        this.reconnectAttempts.delete(namespace);
    }

    /**
     * Event emitter functionality
     * @param {string} event - Event name
     * @param {...any} args - Event arguments
     */
    emit(event, ...args) {
        const handlers = this.eventHandlers.get(event) || [];
        handlers.forEach(handler => {
            try {
                handler(...args);
            } catch (error) {
                console.error(`Event handler error for ${event}:`, error);
            }
        });
    }

    /**
     * Add event listener
     * @param {string} event - Event name
     * @param {Function} handler - Event handler
     */
    on(event, handler) {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, []);
        }
        this.eventHandlers.get(event).push(handler);
    }

    /**
     * Remove event listener
     * @param {string} event - Event name
     * @param {Function} handler - Event handler to remove
     */
    off(event, handler) {
        const handlers = this.eventHandlers.get(event);
        if (handlers) {
            const index = handlers.indexOf(handler);
            if (index > -1) {
                handlers.splice(index, 1);
            }
        }
    }

    /**
     * Add one-time event listener
     * @param {string} event - Event name
     * @param {Function} handler - Event handler
     */
    once(event, handler) {
        const onceHandler = (...args) => {
            handler(...args);
            this.off(event, onceHandler);
        };
        this.on(event, onceHandler);
    }

    /**
     * Disconnect from all namespaces
     */
    disconnect() {
        console.log('🔌 Disconnecting from WebSocket server...');
        
        for (const [namespace, socket] of this.connections.entries()) {
            socket.disconnect();
            console.log(`✅ Disconnected from ${namespace}`);
        }
        
        this.connections.clear();
        this.subscriptions.clear();
        this.reconnectAttempts.clear();
        
        this.emit('client:disconnected');
        console.log('✅ WebSocket client disconnected');
    }

    /**
     * Get connection status
     * @returns {Object} Connection status
     */
    getStatus() {
        const status = {
            connected: this.connections.size > 0,
            connectedNamespaces: Array.from(this.connections.keys()),
            subscriptions: Array.from(this.subscriptions.keys()),
            isAuthenticated: this.isAuthenticated,
            clientId: this.clientId,
            features: this.features,
            reconnectAttempts: Object.fromEntries(this.reconnectAttempts)
        };

        return status;
    }

    /**
     * Send heartbeat to maintain connection
     */
    sendHeartbeat() {
        const mainSocket = this.connections.get('main');
        if (mainSocket) {
            mainSocket.emit('ping');
        }
    }

    /**
     * Start automatic heartbeat
     * @param {number} interval - Heartbeat interval in ms (default: 30000)
     */
    startHeartbeat(interval = 30000) {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        
        this.heartbeatInterval = setInterval(() => {
            this.sendHeartbeat();
        }, interval);
        
        console.log(`💓 Heartbeat started (${interval}ms interval)`);
    }

    /**
     * Stop automatic heartbeat
     */
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
            console.log('💓 Heartbeat stopped');
        }
    }
}

/**
 * Utility functions for WebSocket client integration
 */
export const WebSocketUtils = {
    /**
     * Create a configured WebSocket client
     * @param {WebSocketConfig} config - Client configuration
     * @returns {WebSocketRealTimeClient} Configured client instance
     */
    createClient(config) {
        return new WebSocketRealTimeClient(config);
    },

    /**
     * Validate subscription configuration
     * @param {SubscriptionConfig} config - Subscription configuration
     * @returns {boolean} Validation result
     */
    validateSubscriptionConfig(config) {
        if (!config || typeof config !== 'object') {
            return false;
        }

        // At least one subscription target should be specified
        const hasTarget = !!(
            config.productIds?.length ||
            config.warehouseIds?.length ||
            config.categories?.length ||
            config.orderIds?.length ||
            config.customerId ||
            config.activityTypes?.length
        );

        return hasTarget;
    },

    /**
     * Format error messages for user-friendly display
     * @param {Error} error - Error object
     * @returns {string} Formatted error message
     */
    formatError(error) {
        const errorMessages = {
            'Connection timeout': 'Unable to connect to real-time service. Please check your internet connection.',
            'Rate limit exceeded': 'Too many requests. Please wait a moment before trying again.',
            'Authentication required': 'Please log in to access real-time features.',
            'Invalid credentials': 'Your session has expired. Please log in again.',
            'Subscription failed': 'Unable to subscribe to updates. Please try again.',
            'Namespace not connected': 'Real-time service is temporarily unavailable.'
        };

        const message = error.message || 'Unknown error';
        return errorMessages[message] || `Service error: ${message}`;
    },

    /**
     * Create connection configuration from environment
     * @param {Object} env - Environment variables or config object
     * @returns {WebSocketConfig} WebSocket configuration
     */
    createConfigFromEnv(env = {}) {
        return {
            url: env.WEBSOCKET_URL || 'http://localhost:4000',
            token: env.AUTH_TOKEN || null,
            autoReconnect: env.WEBSOCKET_AUTO_RECONNECT !== 'false',
            reconnectDelay: parseInt(env.WEBSOCKET_RECONNECT_DELAY) || 1000,
            maxReconnectAttempts: parseInt(env.WEBSOCKET_MAX_RECONNECT_ATTEMPTS) || 5,
            namespaces: {
                inventory: '/inventory',
                orders: '/orders',
                dashboard: '/dashboard',
                customer: '/customer',
                notifications: '/notifications'
            }
        };
    }
};

// Example usage documentation
export const WebSocketExamples = {
    /**
     * Basic connection example
     */
    basicConnection: `
        import { WebSocketRealTimeClient, WebSocketUtils } from './websocket-client.js';
        
        const client = new WebSocketRealTimeClient({
            url: 'http://localhost:4000',
            token: 'your-jwt-token'
        });
        
        await client.connect();
    `,

    /**
     * Inventory monitoring example
     */
    inventoryMonitoring: `
        // Subscribe to inventory updates
        await client.subscribeToInventory({
            productIds: ['product-123', 'product-456'],
            warehouseIds: ['warehouse-1'],
            lowStockOnly: true
        });
        
        // Listen for updates
        client.on('inventory:update', (data) => {
            console.log('Inventory updated:', data);
        });
        
        client.on('inventory:low-stock', (data) => {
            alert('Low stock alert: ' + data.data.productId);
        });
    `,

    /**
     * Order tracking example
     */
    orderTracking: `
        // Subscribe to order updates
        await client.subscribeToOrders({
            customerId: 'customer-123',
            trackingEnabled: true
        });
        
        // Track specific order
        const tracking = await client.trackOrder('order-456');
        console.log('Order status:', tracking.status);
        
        // Listen for tracking updates
        client.on('order:tracking', (data) => {
            updateOrderStatus(data);
        });
    `,

    /**
     * Dashboard integration example
     */
    dashboardIntegration: `
        // Subscribe to dashboard updates
        await client.subscribeToDashboard('main-dashboard', [
            'inventory-summary',
            'order-stats',
            'customer-activity'
        ], 5000); // Update every 5 seconds
        
        // Listen for dashboard data
        client.on('dashboard:data', (data) => {
            updateDashboardWidgets(data.widgets);
        });
        
        client.on('dashboard:metrics:live', (data) => {
            updateMetricsDisplay(data.metrics);
        });
    `
};

export { WebSocketRealTimeClient };
export default WebSocketRealTimeClient;