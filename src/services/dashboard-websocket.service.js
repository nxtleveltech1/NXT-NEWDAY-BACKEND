import { WebSocketServer } from 'ws';
import { EventEmitter } from 'events';
import { 
  nileDb, 
  getDashboardMetrics, 
  getDashboardEvents, 
  getRealTimeData,
  insertDashboardEvent,
  storeRealTimeData 
} from '../config/niledb.config.js';

/**
 * Dashboard WebSocket Service
 * Provides real-time updates for dashboard widgets
 */

class DashboardWebSocketService extends EventEmitter {
  constructor() {
    super();
    this.wss = null;
    this.clients = new Map();
    this.subscriptions = new Map();
    this.dataUpdateInterval = null;
    this.heartbeatInterval = null;
    this.isRunning = false;
  }

  /**
   * Initialize WebSocket server
   */
  initialize(server, options = {}) {
    try {
      this.wss = new WebSocketServer({ 
        server,
        path: '/dashboard-ws',
        ...options
      });

      this.wss.on('connection', (ws, request) => {
        this.handleConnection(ws, request);
      });

      this.startDataUpdates();
      this.startHeartbeat();
      this.isRunning = true;

      console.log('✅ Dashboard WebSocket service initialized');
      return { success: true };
    } catch (error) {
      console.error('❌ Failed to initialize Dashboard WebSocket service:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle new WebSocket connection
   */
  handleConnection(ws, request) {
    const clientId = this.generateClientId();
    const clientInfo = {
      ws,
      id: clientId,
      ip: request.socket.remoteAddress,
      connectedAt: new Date(),
      subscriptions: new Set(),
      lastPing: new Date(),
      isAlive: true
    };

    this.clients.set(clientId, clientInfo);

    console.log(`📱 Dashboard client ${clientId} connected from ${clientInfo.ip}`);

    // Handle incoming messages
    ws.on('message', (data) => {
      this.handleClientMessage(clientId, data);
    });

    // Handle client disconnect
    ws.on('close', () => {
      this.handleClientDisconnect(clientId);
    });

    // Handle ping/pong for connection health
    ws.on('pong', () => {
      const client = this.clients.get(clientId);
      if (client) {
        client.isAlive = true;
        client.lastPing = new Date();
      }
    });

    // Send welcome message
    this.sendToClient(clientId, {
      type: 'welcome',
      clientId,
      timestamp: new Date().toISOString(),
      availableStreams: [
        'sales-metrics',
        'inventory-status', 
        'customer-activity',
        'system-performance',
        'real-time-analytics',
        'notifications',
        'alerts'
      ]
    });

    // Log connection event
    insertDashboardEvent('client_connected', {
      clientId,
      ip: clientInfo.ip,
      userAgent: request.headers['user-agent']
    }, 'websocket', 'info').catch(console.error);
  }

  /**
   * Handle client message
   */
  handleClientMessage(clientId, data) {
    try {
      const message = JSON.parse(data.toString());
      const client = this.clients.get(clientId);
      
      if (!client) return;

      switch (message.type) {
        case 'subscribe':
          this.handleSubscription(clientId, message.streams || []);
          break;
        case 'unsubscribe':
          this.handleUnsubscription(clientId, message.streams || []);
          break;
        case 'ping':
          this.sendToClient(clientId, { type: 'pong', timestamp: new Date().toISOString() });
          break;
        case 'request-data':
          this.handleDataRequest(clientId, message);
          break;
        default:
          console.warn(`Unknown message type: ${message.type} from client ${clientId}`);
      }
    } catch (error) {
      console.error(`Error handling message from client ${clientId}:`, error);
      this.sendToClient(clientId, {
        type: 'error',
        message: 'Invalid message format',
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Handle client subscription
   */
  handleSubscription(clientId, streams) {
    const client = this.clients.get(clientId);
    if (!client) return;

    streams.forEach(stream => {
      client.subscriptions.add(stream);
      
      if (!this.subscriptions.has(stream)) {
        this.subscriptions.set(stream, new Set());
      }
      this.subscriptions.get(stream).add(clientId);
    });

    this.sendToClient(clientId, {
      type: 'subscription-confirmed',
      streams,
      timestamp: new Date().toISOString()
    });

    console.log(`📡 Client ${clientId} subscribed to:`, streams);
  }

  /**
   * Handle client unsubscription
   */
  handleUnsubscription(clientId, streams) {
    const client = this.clients.get(clientId);
    if (!client) return;

    streams.forEach(stream => {
      client.subscriptions.delete(stream);
      
      const streamSubscribers = this.subscriptions.get(stream);
      if (streamSubscribers) {
        streamSubscribers.delete(clientId);
        if (streamSubscribers.size === 0) {
          this.subscriptions.delete(stream);
        }
      }
    });

    this.sendToClient(clientId, {
      type: 'unsubscription-confirmed',
      streams,
      timestamp: new Date().toISOString()
    });

    console.log(`📡 Client ${clientId} unsubscribed from:`, streams);
  }

  /**
   * Handle data request
   */
  async handleDataRequest(clientId, message) {
    try {
      const { dataType, params = {} } = message;
      let data = null;

      switch (dataType) {
        case 'dashboard-metrics':
          const metricsResult = await getDashboardMetrics(params.timeRange, params.limit);
          data = metricsResult.success ? metricsResult.data : [];
          break;
        case 'dashboard-events':
          const eventsResult = await getDashboardEvents(params.limit, params.eventType);
          data = eventsResult.success ? eventsResult.data : [];
          break;
        case 'real-time-data':
          const realtimeResult = await getRealTimeData(params.type, params.limit);
          data = realtimeResult.success ? realtimeResult.data : [];
          break;
        default:
          data = await this.generateMockData(dataType, params);
      }

      this.sendToClient(clientId, {
        type: 'data-response',
        dataType,
        data,
        timestamp: new Date().toISOString(),
        requestId: message.requestId
      });
    } catch (error) {
      console.error(`Error handling data request from client ${clientId}:`, error);
      this.sendToClient(clientId, {
        type: 'error',
        message: 'Failed to fetch data',
        dataType: message.dataType,
        requestId: message.requestId,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Handle client disconnect
   */
  handleClientDisconnect(clientId) {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Remove from all subscriptions
    client.subscriptions.forEach(stream => {
      const streamSubscribers = this.subscriptions.get(stream);
      if (streamSubscribers) {
        streamSubscribers.delete(clientId);
        if (streamSubscribers.size === 0) {
          this.subscriptions.delete(stream);
        }
      }
    });

    this.clients.delete(clientId);
    console.log(`📱 Dashboard client ${clientId} disconnected`);

    // Log disconnect event
    insertDashboardEvent('client_disconnected', {
      clientId,
      connectionDuration: Date.now() - client.connectedAt.getTime()
    }, 'websocket', 'info').catch(console.error);
  }

  /**
   * Send message to specific client
   */
  sendToClient(clientId, message) {
    const client = this.clients.get(clientId);
    if (client && client.ws.readyState === 1) {
      try {
        client.ws.send(JSON.stringify(message));
      } catch (error) {
        console.error(`Error sending message to client ${clientId}:`, error);
        this.handleClientDisconnect(clientId);
      }
    }
  }

  /**
   * Broadcast message to all subscribers of a stream
   */
  broadcastToStream(streamName, message) {
    const subscribers = this.subscriptions.get(streamName);
    if (!subscribers) return;

    const broadcastMessage = {
      ...message,
      stream: streamName,
      timestamp: new Date().toISOString()
    };

    subscribers.forEach(clientId => {
      this.sendToClient(clientId, broadcastMessage);
    });
  }

  /**
   * Start periodic data updates
   */
  startDataUpdates() {
    this.dataUpdateInterval = setInterval(async () => {
      try {
        // Sales metrics update
        if (this.subscriptions.has('sales-metrics')) {
          const salesData = await this.generateSalesMetrics();
          this.broadcastToStream('sales-metrics', {
            type: 'data-update',
            data: salesData
          });
        }

        // Inventory status update
        if (this.subscriptions.has('inventory-status')) {
          const inventoryData = await this.generateInventoryStatus();
          this.broadcastToStream('inventory-status', {
            type: 'data-update',
            data: inventoryData
          });
        }

        // Customer activity update
        if (this.subscriptions.has('customer-activity')) {
          const customerData = await this.generateCustomerActivity();
          this.broadcastToStream('customer-activity', {
            type: 'data-update',
            data: customerData
          });
        }

        // System performance update
        if (this.subscriptions.has('system-performance')) {
          const perfData = await this.generateSystemPerformance();
          this.broadcastToStream('system-performance', {
            type: 'data-update',
            data: perfData
          });
        }

        // Real-time analytics update
        if (this.subscriptions.has('real-time-analytics')) {
          const analyticsData = await this.generateRealtimeAnalytics();
          this.broadcastToStream('real-time-analytics', {
            type: 'data-update',
            data: analyticsData
          });
        }

      } catch (error) {
        console.error('Error in data update cycle:', error);
      }
    }, 5000); // Update every 5 seconds

    console.log('📊 Dashboard data updates started');
  }

  /**
   * Start heartbeat to check client connections
   */
  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      this.clients.forEach((client, clientId) => {
        if (!client.isAlive) {
          console.log(`💔 Client ${clientId} is not responding, terminating connection`);
          client.ws.terminate();
          this.handleClientDisconnect(clientId);
          return;
        }

        client.isAlive = false;
        if (client.ws.readyState === 1) {
          client.ws.ping();
        }
      });
    }, 30000); // Check every 30 seconds

    console.log('💓 Dashboard heartbeat started');
  }

  /**
   * Generate sales metrics data
   */
  async generateSalesMetrics() {
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    return {
      totalSales: Math.floor(Math.random() * 50000) + 10000,
      salesGrowth: (Math.random() * 20 - 10).toFixed(2),
      ordersCount: Math.floor(Math.random() * 500) + 100,
      averageOrderValue: (Math.random() * 100 + 50).toFixed(2),
      topProducts: [
        { name: 'Product A', sales: Math.floor(Math.random() * 1000) + 500 },
        { name: 'Product B', sales: Math.floor(Math.random() * 800) + 400 },
        { name: 'Product C', sales: Math.floor(Math.random() * 600) + 300 }
      ],
      hourlySales: Array.from({ length: 24 }, (_, i) => ({
        hour: i,
        sales: Math.floor(Math.random() * 2000) + 500,
        orders: Math.floor(Math.random() * 50) + 10
      })),
      timestamp: now.toISOString()
    };
  }

  /**
   * Generate inventory status data
   */
  async generateInventoryStatus() {
    return {
      totalItems: Math.floor(Math.random() * 10000) + 5000,
      lowStockItems: Math.floor(Math.random() * 50) + 10,
      outOfStockItems: Math.floor(Math.random() * 20) + 5,
      totalValue: Math.floor(Math.random() * 1000000) + 500000,
      categories: [
        { name: 'Electronics', items: Math.floor(Math.random() * 1000) + 500, value: Math.floor(Math.random() * 200000) + 100000 },
        { name: 'Clothing', items: Math.floor(Math.random() * 800) + 400, value: Math.floor(Math.random() * 150000) + 75000 },
        { name: 'Home & Garden', items: Math.floor(Math.random() * 600) + 300, value: Math.floor(Math.random() * 100000) + 50000 }
      ],
      recentMovements: Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        product: `Product ${String.fromCharCode(65 + i)}`,
        type: Math.random() > 0.5 ? 'in' : 'out',
        quantity: Math.floor(Math.random() * 100) + 1,
        timestamp: new Date(Date.now() - Math.random() * 86400000).toISOString()
      })),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Generate customer activity data
   */
  async generateCustomerActivity() {
    return {
      activeUsers: Math.floor(Math.random() * 1000) + 500,
      newRegistrations: Math.floor(Math.random() * 50) + 10,
      totalCustomers: Math.floor(Math.random() * 50000) + 25000,
      conversionRate: (Math.random() * 5 + 2).toFixed(2),
      recentActivity: Array.from({ length: 15 }, (_, i) => ({
        id: i + 1,
        customer: `Customer ${i + 1}`,
        action: ['login', 'purchase', 'browse', 'register'][Math.floor(Math.random() * 4)],
        timestamp: new Date(Date.now() - Math.random() * 3600000).toISOString(),
        value: Math.random() > 0.5 ? Math.floor(Math.random() * 500) + 50 : null
      })),
      geographicData: [
        { country: 'United States', users: Math.floor(Math.random() * 500) + 200 },
        { country: 'United Kingdom', users: Math.floor(Math.random() * 300) + 100 },
        { country: 'Germany', users: Math.floor(Math.random() * 200) + 80 },
        { country: 'France', users: Math.floor(Math.random() * 150) + 60 },
        { country: 'Canada', users: Math.floor(Math.random() * 100) + 40 }
      ],
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Generate system performance data
   */
  async generateSystemPerformance() {
    return {
      cpuUsage: Math.random() * 100,
      memoryUsage: Math.random() * 100,
      diskUsage: Math.random() * 100,
      networkTraffic: {
        incoming: Math.floor(Math.random() * 1000) + 100,
        outgoing: Math.floor(Math.random() * 800) + 80
      },
      responseTime: Math.floor(Math.random() * 500) + 50,
      activeConnections: Math.floor(Math.random() * 1000) + 500,
      errorRate: Math.random() * 5,
      uptime: Math.floor(Math.random() * 86400) + 3600,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Generate real-time analytics data
   */
  async generateRealtimeAnalytics() {
    return {
      pageViews: Math.floor(Math.random() * 10000) + 5000,
      uniqueVisitors: Math.floor(Math.random() * 2000) + 1000,
      bounceRate: (Math.random() * 50 + 25).toFixed(2),
      sessionDuration: Math.floor(Math.random() * 600) + 120,
      topPages: Array.from({ length: 5 }, (_, i) => ({
        page: `/page-${i + 1}`,
        views: Math.floor(Math.random() * 1000) + 100,
        uniqueViews: Math.floor(Math.random() * 800) + 80
      })),
      trafficSources: {
        organic: Math.floor(Math.random() * 1000) + 500,
        direct: Math.floor(Math.random() * 800) + 400,
        social: Math.floor(Math.random() * 600) + 300,
        referral: Math.floor(Math.random() * 400) + 200,
        email: Math.floor(Math.random() * 200) + 100
      },
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Generate mock data for unknown data types
   */
  async generateMockData(dataType, params = {}) {
    const mockDataGenerators = {
      'financial-overview': () => ({
        revenue: Math.floor(Math.random() * 100000) + 50000,
        profit: Math.floor(Math.random() * 20000) + 10000,
        expenses: Math.floor(Math.random() * 30000) + 15000,
        roi: (Math.random() * 20 + 5).toFixed(2)
      }),
      'notifications': () => Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        type: ['info', 'warning', 'error', 'success'][Math.floor(Math.random() * 4)],
        title: `Notification ${i + 1}`,
        message: `This is a sample notification message ${i + 1}`,
        timestamp: new Date(Date.now() - Math.random() * 86400000).toISOString(),
        read: Math.random() > 0.5
      })),
      'alerts': () => Array.from({ length: 5 }, (_, i) => ({
        id: i + 1,
        severity: ['low', 'medium', 'high', 'critical'][Math.floor(Math.random() * 4)],
        title: `Alert ${i + 1}`,
        description: `This is a sample alert description ${i + 1}`,
        timestamp: new Date(Date.now() - Math.random() * 3600000).toISOString(),
        resolved: Math.random() > 0.3
      }))
    };

    const generator = mockDataGenerators[dataType];
    return generator ? generator() : { message: `No data generator for ${dataType}` };
  }

  /**
   * Generate unique client ID
   */
  generateClientId() {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get service statistics
   */
  getStats() {
    return {
      isRunning: this.isRunning,
      totalClients: this.clients.size,
      totalSubscriptions: this.subscriptions.size,
      clientDetails: Array.from(this.clients.entries()).map(([id, client]) => ({
        id,
        ip: client.ip,
        connectedAt: client.connectedAt,
        subscriptions: Array.from(client.subscriptions),
        isAlive: client.isAlive,
        lastPing: client.lastPing
      })),
      subscriptionDetails: Array.from(this.subscriptions.entries()).map(([stream, subscribers]) => ({
        stream,
        subscriberCount: subscribers.size
      }))
    };
  }

  /**
   * Trigger manual notification
   */
  async sendNotification(type, data, targetStream = 'notifications') {
    try {
      // Store in database
      await insertDashboardEvent('notification', { type, ...data }, 'manual', 'info');

      // Broadcast to subscribers
      this.broadcastToStream(targetStream, {
        type: 'notification',
        notificationType: type,
        data,
        timestamp: new Date().toISOString()
      });

      return { success: true };
    } catch (error) {
      console.error('Error sending notification:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Cleanup and close service
   */
  async shutdown() {
    try {
      if (this.dataUpdateInterval) {
        clearInterval(this.dataUpdateInterval);
        this.dataUpdateInterval = null;
      }

      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }

      // Close all client connections
      this.clients.forEach((client, clientId) => {
        if (client.ws.readyState === 1) {
          client.ws.close();
        }
      });

      // Close WebSocket server
      if (this.wss) {
        this.wss.close();
      }

      this.clients.clear();
      this.subscriptions.clear();
      this.isRunning = false;

      console.log('✅ Dashboard WebSocket service shut down');
      return { success: true };
    } catch (error) {
      console.error('❌ Error shutting down Dashboard WebSocket service:', error);
      return { success: false, error: error.message };
    }
  }
}

// Create singleton instance
export const dashboardWebSocketService = new DashboardWebSocketService();

// Export class for testing
export { DashboardWebSocketService };