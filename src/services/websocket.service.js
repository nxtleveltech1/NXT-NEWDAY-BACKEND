/**
 * Production-Ready WebSocket Service
 * Comprehensive Socket.io implementation with real-time features
 * 
 * Features:
 * - Real-time inventory updates
 * - Live order tracking
 * - Customer activity streaming
 * - Multi-room support
 * - Reconnection handling
 * - Message queuing
 * - Authentication
 * - Rate limiting
 * - Connection monitoring
 */

import { Server as SocketIOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { EventEmitter } from 'events';
import jwt from 'jsonwebtoken';
import Redis from 'redis';

class WebSocketService extends EventEmitter {
  constructor() {
    super();
    this.io = null;
    this.redisAdapter = null;
    this.connections = new Map();
    this.rooms = new Map();
    this.messageQueue = new Map();
    this.rateLimiters = new Map();
    
    // Metrics
    this.metrics = {
      totalConnections: 0,
      activeConnections: 0,
      messagesSent: 0,
      messagesReceived: 0,
      reconnections: 0,
      errors: 0,
      roomCount: 0,
      uptime: Date.now()
    };

    // Configuration
    this.config = {
      cors: {
        origin: process.env.FRONTEND_URL || "http://localhost:3000",
        methods: ["GET", "POST"],
        credentials: true
      },
      pingTimeout: 60000,
      pingInterval: 25000,
      maxHttpBufferSize: 1e6,
      transports: ['polling', 'websocket'],
      allowUpgrades: true
    };

    // Message queue configuration
    this.queueConfig = {
      maxQueueSize: 1000,
      messageRetention: 5 * 60 * 1000, // 5 minutes
      cleanupInterval: 60 * 1000 // 1 minute
    };

    // Rate limiting configuration
    this.rateLimitConfig = {
      windowMs: 60 * 1000, // 1 minute
      maxMessages: 100,
      skipSuccessfulRequests: false
    };

    this.setupCleanupIntervals();
  }

  /**
   * Initialize WebSocket server
   */
  async initialize(httpServer, options = {}) {
    try {
      // Merge configuration
      const finalConfig = { ...this.config, ...options };

      // Create Socket.io server
      this.io = new SocketIOServer(httpServer, finalConfig);

      // Setup Redis adapter for scaling (if Redis is available)
      await this.setupRedisAdapter();

      // Setup middleware
      this.setupMiddleware();

      // Setup connection handlers
      this.setupConnectionHandlers();

      // Setup namespace handlers
      this.setupNamespaces();

      // Start monitoring
      this.startMonitoring();

      console.log('🚀 WebSocket Service initialized successfully');
      console.log(`📡 Listening on ${finalConfig.cors.origin}`);
      
      this.emit('service:initialized');
      return { success: true, port: httpServer.address()?.port };
    } catch (error) {
      console.error('❌ Failed to initialize WebSocket service:', error);
      this.emit('service:error', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Setup Redis adapter for horizontal scaling
   */
  async setupRedisAdapter() {
    try {
      if (process.env.REDIS_URL) {
        const pubClient = Redis.createClient({ url: process.env.REDIS_URL });
        const subClient = pubClient.duplicate();

        await Promise.all([
          pubClient.connect(),
          subClient.connect()
        ]);

        this.io.adapter(createAdapter(pubClient, subClient));
        this.redisAdapter = { pubClient, subClient };
        
        console.log('✅ Redis adapter configured for WebSocket scaling');
      }
    } catch (error) {
      console.warn('⚠️ Redis adapter setup failed, using memory adapter:', error.message);
    }
  }

  /**
   * Setup middleware for authentication and rate limiting
   */
  setupMiddleware() {
    // Authentication middleware
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
          // Allow anonymous connections for public features
          socket.userId = null;
          socket.authenticated = false;
          return next();
        }

        // Verify JWT token
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret');
        socket.userId = decoded.sub || decoded.userId;
        socket.userRole = decoded.role || 'user';
        socket.authenticated = true;
        
        next();
      } catch (error) {
        console.warn('Authentication failed:', error.message);
        socket.authenticated = false;
        socket.userId = null;
        next(); // Allow connection but mark as unauthenticated
      }
    });

    // Rate limiting middleware
    this.io.use((socket, next) => {
      const clientId = socket.handshake.address;
      const now = Date.now();
      
      if (!this.rateLimiters.has(clientId)) {
        this.rateLimiters.set(clientId, {
          requests: [],
          windowStart: now
        });
      }

      const limiter = this.rateLimiters.get(clientId);
      
      // Clean old requests
      limiter.requests = limiter.requests.filter(
        timestamp => now - timestamp < this.rateLimitConfig.windowMs
      );

      // Check rate limit
      if (limiter.requests.length >= this.rateLimitConfig.maxMessages) {
        return next(new Error('Rate limit exceeded'));
      }

      limiter.requests.push(now);
      next();
    });

    // Connection info middleware
    this.io.use((socket, next) => {
      socket.clientInfo = {
        ip: socket.handshake.address,
        userAgent: socket.handshake.headers['user-agent'],
        connectedAt: new Date(),
        lastActivity: new Date()
      };
      next();
    });
  }

  /**
   * Setup main connection handlers
   */
  setupConnectionHandlers() {
    this.io.on('connection', (socket) => {
      this.handleConnection(socket);
    });
  }

  /**
   * Setup specialized namespaces
   */
  setupNamespaces() {
    // Inventory namespace
    const inventoryNs = this.io.of('/inventory');
    inventoryNs.on('connection', (socket) => {
      this.handleInventoryConnection(socket);
    });

    // Orders namespace
    const ordersNs = this.io.of('/orders');
    ordersNs.on('connection', (socket) => {
      this.handleOrdersConnection(socket);
    });

    // Dashboard namespace
    const dashboardNs = this.io.of('/dashboard');
    dashboardNs.on('connection', (socket) => {
      this.handleDashboardConnection(socket);
    });

    // Notifications namespace
    const notificationsNs = this.io.of('/notifications');
    notificationsNs.on('connection', (socket) => {
      this.handleNotificationsConnection(socket);
    });
  }

  /**
   * Handle main connection
   */
  handleConnection(socket) {
    const clientId = this.generateClientId();
    const connectionData = {
      id: clientId,
      socket,
      userId: socket.userId,
      authenticated: socket.authenticated,
      subscriptions: new Set(),
      messageQueue: [],
      reconnectCount: 0,
      ...socket.clientInfo
    };

    this.connections.set(clientId, connectionData);
    this.metrics.totalConnections++;
    this.metrics.activeConnections++;

    console.log(`🔌 Client connected: ${clientId}`, {
      userId: socket.userId,
      authenticated: socket.authenticated,
      ip: socket.clientInfo.ip
    });

    // Setup client handlers
    this.setupClientHandlers(socket, connectionData);

    // Send welcome message
    socket.emit('connection:established', {
      clientId,
      authenticated: socket.authenticated,
      features: this.getAvailableFeatures(),
      timestamp: new Date().toISOString()
    });

    // Process queued messages if reconnection
    this.processQueuedMessages(clientId);

    this.emit('client:connected', { clientId, userId: socket.userId });
  }

  /**
   * Setup handlers for individual client
   */
  setupClientHandlers(socket, connectionData) {
    const { id: clientId } = connectionData;

    // Authentication events
    socket.on('auth:login', async (data) => {
      await this.handleLogin(socket, connectionData, data);
    });

    socket.on('auth:logout', () => {
      this.handleLogout(socket, connectionData);
    });

    // Subscription management
    socket.on('subscribe', (data) => {
      this.handleSubscription(socket, connectionData, data);
    });

    socket.on('unsubscribe', (data) => {
      this.handleUnsubscription(socket, connectionData, data);
    });

    // Room management
    socket.on('join:room', (data) => {
      this.handleJoinRoom(socket, connectionData, data);
    });

    socket.on('leave:room', (data) => {
      this.handleLeaveRoom(socket, connectionData, data);
    });

    // Real-time data requests
    socket.on('data:request', (data) => {
      this.handleDataRequest(socket, connectionData, data);
    });

    // Message sending
    socket.on('message:send', (data) => {
      this.handleMessageSend(socket, connectionData, data);
    });

    // Heartbeat
    socket.on('ping', () => {
      connectionData.lastActivity = new Date();
      socket.emit('pong', { timestamp: new Date().toISOString() });
    });

    // Reconnection handling
    socket.on('reconnect:attempt', (data) => {
      this.handleReconnectAttempt(socket, connectionData, data);
    });

    // Disconnection
    socket.on('disconnect', (reason) => {
      this.handleDisconnection(clientId, reason);
    });

    // Error handling
    socket.on('error', (error) => {
      this.metrics.errors++;
      console.error(`Socket error for client ${clientId}:`, error);
      this.emit('client:error', { clientId, error });
    });

    // Activity tracking
    socket.onAny(() => {
      connectionData.lastActivity = new Date();
      this.metrics.messagesReceived++;
    });
  }

  /**
   * Handle inventory namespace connections
   */
  handleInventoryConnection(socket) {
    console.log(`📦 Inventory client connected: ${socket.id}`);

    socket.on('inventory:subscribe', (data) => {
      const { productIds, warehouseIds, categories } = data;
      
      // Join relevant rooms
      if (productIds) {
        productIds.forEach(id => socket.join(`product:${id}`));
      }
      if (warehouseIds) {
        warehouseIds.forEach(id => socket.join(`warehouse:${id}`));
      }
      if (categories) {
        categories.forEach(cat => socket.join(`category:${cat}`));
      }

      socket.emit('inventory:subscribed', {
        subscriptions: data,
        timestamp: new Date().toISOString()
      });
    });

    socket.on('inventory:request', async (data) => {
      try {
        const inventoryData = await this.getInventoryData(data);
        socket.emit('inventory:data', inventoryData);
      } catch (error) {
        socket.emit('inventory:error', { error: error.message });
      }
    });
  }

  /**
   * Handle orders namespace connections
   */
  handleOrdersConnection(socket) {
    console.log(`🛒 Orders client connected: ${socket.id}`);

    socket.on('orders:subscribe', (data) => {
      const { orderIds, customerId, status } = data;
      
      if (orderIds) {
        orderIds.forEach(id => socket.join(`order:${id}`));
      }
      if (customerId) {
        socket.join(`customer:${customerId}`);
      }
      if (status) {
        socket.join(`status:${status}`);
      }

      socket.emit('orders:subscribed', {
        subscriptions: data,
        timestamp: new Date().toISOString()
      });
    });

    socket.on('orders:track', async (data) => {
      try {
        const trackingData = await this.getOrderTracking(data.orderId);
        socket.emit('orders:tracking', trackingData);
      } catch (error) {
        socket.emit('orders:error', { error: error.message });
      }
    });
  }

  /**
   * Handle dashboard namespace connections
   */
  handleDashboardConnection(socket) {
    console.log(`📊 Dashboard client connected: ${socket.id}`);

    socket.on('dashboard:subscribe', (data) => {
      const { widgets, dashboardId } = data;
      
      socket.join(`dashboard:${dashboardId}`);
      if (widgets) {
        widgets.forEach(widget => socket.join(`widget:${widget}`));
      }

      socket.emit('dashboard:subscribed', {
        dashboardId,
        widgets,
        timestamp: new Date().toISOString()
      });

      // Send initial dashboard data
      this.sendDashboardData(socket, dashboardId, widgets);
    });
  }

  /**
   * Handle notifications namespace connections
   */
  handleNotificationsConnection(socket) {
    console.log(`🔔 Notifications client connected: ${socket.id}`);

    if (socket.userId) {
      socket.join(`user:${socket.userId}`);
      socket.join(`role:${socket.userRole}`);
    }

    socket.on('notifications:subscribe', (data) => {
      const { types, priority } = data;
      
      if (types) {
        types.forEach(type => socket.join(`notification:${type}`));
      }
      if (priority) {
        socket.join(`priority:${priority}`);
      }

      socket.emit('notifications:subscribed', {
        subscriptions: data,
        timestamp: new Date().toISOString()
      });
    });
  }

  /**
   * Broadcasting methods
   */

  // Broadcast inventory updates
  async broadcastInventoryUpdate(data) {
    const { productId, warehouseId, category, update } = data;
    
    const message = {
      type: 'inventory:update',
      data: update,
      timestamp: new Date().toISOString()
    };

    if (productId) {
      this.io.of('/inventory').to(`product:${productId}`).emit('inventory:update', message);
    }
    if (warehouseId) {
      this.io.of('/inventory').to(`warehouse:${warehouseId}`).emit('inventory:update', message);
    }
    if (category) {
      this.io.of('/inventory').to(`category:${category}`).emit('inventory:update', message);
    }

    this.metrics.messagesSent++;
    this.emit('inventory:broadcasted', { productId, warehouseId, category });
  }

  // Broadcast order updates
  async broadcastOrderUpdate(data) {
    const { orderId, customerId, status, update } = data;
    
    const message = {
      type: 'order:update',
      data: update,
      timestamp: new Date().toISOString()
    };

    if (orderId) {
      this.io.of('/orders').to(`order:${orderId}`).emit('order:update', message);
    }
    if (customerId) {
      this.io.of('/orders').to(`customer:${customerId}`).emit('order:update', message);
    }
    if (status) {
      this.io.of('/orders').to(`status:${status}`).emit('order:update', message);
    }

    this.metrics.messagesSent++;
    this.emit('order:broadcasted', { orderId, customerId, status });
  }

  // Broadcast customer activity
  async broadcastCustomerActivity(data) {
    const { customerId, activity } = data;
    
    const message = {
      type: 'customer:activity',
      data: activity,
      timestamp: new Date().toISOString()
    };

    // Broadcast to dashboard subscribers
    this.io.of('/dashboard').to('widget:customer-activity').emit('customer:activity', message);
    
    // Broadcast to specific customer room if exists
    this.io.of('/orders').to(`customer:${customerId}`).emit('customer:activity', message);

    this.metrics.messagesSent++;
    this.emit('customer:activity:broadcasted', { customerId });
  }

  // Send notifications
  async sendNotification(data) {
    const { userId, userRole, type, priority, message, persistent } = data;
    
    const notification = {
      type: 'notification',
      notificationType: type,
      priority: priority || 'normal',
      message,
      persistent: persistent || false,
      timestamp: new Date().toISOString(),
      id: this.generateNotificationId()
    };

    const notificationsNs = this.io.of('/notifications');

    // Send to specific user
    if (userId) {
      notificationsNs.to(`user:${userId}`).emit('notification', notification);
    }
    
    // Send to role-based rooms
    if (userRole) {
      notificationsNs.to(`role:${userRole}`).emit('notification', notification);
    }
    
    // Send to type-based rooms
    if (type) {
      notificationsNs.to(`notification:${type}`).emit('notification', notification);
    }
    
    // Send to priority-based rooms
    if (priority) {
      notificationsNs.to(`priority:${priority}`).emit('notification', notification);
    }

    // Queue persistent notifications
    if (persistent) {
      await this.queuePersistentNotification(notification);
    }

    this.metrics.messagesSent++;
    this.emit('notification:sent', notification);
    
    return notification;
  }

  /**
   * Message queuing for offline clients
   */
  async queueMessage(clientId, message) {
    if (!this.messageQueue.has(clientId)) {
      this.messageQueue.set(clientId, []);
    }

    const queue = this.messageQueue.get(clientId);
    queue.push({
      ...message,
      queuedAt: new Date().toISOString()
    });

    // Limit queue size
    if (queue.length > this.queueConfig.maxQueueSize) {
      queue.shift(); // Remove oldest message
    }
  }

  async processQueuedMessages(clientId) {
    const queue = this.messageQueue.get(clientId);
    if (!queue || queue.length === 0) return;

    const connection = this.connections.get(clientId);
    if (!connection) return;

    console.log(`📬 Processing ${queue.length} queued messages for ${clientId}`);

    // Send queued messages
    queue.forEach(message => {
      connection.socket.emit('queued:message', message);
    });

    // Clear processed messages
    this.messageQueue.delete(clientId);
    this.metrics.messagesSent += queue.length;
  }

  /**
   * Connection monitoring and management
   */
  startMonitoring() {
    // Clean up inactive connections
    setInterval(() => {
      this.cleanupInactiveConnections();
    }, 60000); // Every minute

    // Update metrics
    setInterval(() => {
      this.updateMetrics();
    }, 10000); // Every 10 seconds

    // Log statistics
    setInterval(() => {
      this.logStatistics();
    }, 300000); // Every 5 minutes
  }

  cleanupInactiveConnections() {
    const now = Date.now();
    const timeout = 5 * 60 * 1000; // 5 minutes

    for (const [clientId, connection] of this.connections.entries()) {
      if (now - connection.lastActivity.getTime() > timeout) {
        console.log(`🧹 Cleaning up inactive connection: ${clientId}`);
        connection.socket.disconnect(true);
        this.connections.delete(clientId);
        this.metrics.activeConnections--;
      }
    }
  }

  updateMetrics() {
    this.metrics.roomCount = this.io.sockets.adapter.rooms.size;
    this.metrics.activeConnections = this.connections.size;
  }

  logStatistics() {
    console.log('📊 WebSocket Statistics:', {
      activeConnections: this.metrics.activeConnections,
      totalConnections: this.metrics.totalConnections,
      rooms: this.metrics.roomCount,
      messagesSent: this.metrics.messagesSent,
      messagesReceived: this.metrics.messagesReceived,
      reconnections: this.metrics.reconnections,
      errors: this.metrics.errors,
      uptime: Math.floor((Date.now() - this.metrics.uptime) / 1000) + 's'
    });
  }

  /**
   * Utility methods
   */
  setupCleanupIntervals() {
    // Cleanup message queues
    setInterval(() => {
      const now = Date.now();
      for (const [clientId, queue] of this.messageQueue.entries()) {
        this.messageQueue.set(clientId, queue.filter(msg => 
          now - new Date(msg.queuedAt).getTime() < this.queueConfig.messageRetention
        ));
        
        if (this.messageQueue.get(clientId).length === 0) {
          this.messageQueue.delete(clientId);
        }
      }
    }, this.queueConfig.cleanupInterval);

    // Cleanup rate limiters
    setInterval(() => {
      const now = Date.now();
      for (const [clientId, limiter] of this.rateLimiters.entries()) {
        limiter.requests = limiter.requests.filter(
          timestamp => now - timestamp < this.rateLimitConfig.windowMs
        );
        
        if (limiter.requests.length === 0) {
          this.rateLimiters.delete(clientId);
        }
      }
    }, this.rateLimitConfig.windowMs);
  }

  generateClientId() {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  generateNotificationId() {
    return `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  getAvailableFeatures() {
    return [
      'real-time-inventory',
      'live-order-tracking',
      'customer-activity-stream',
      'push-notifications',
      'multi-room-support',
      'message-queuing',
      'reconnection-handling',
      'authentication',
      'rate-limiting'
    ];
  }

  /**
   * Public API methods
   */
  
  // Get service status
  getStatus() {
    return {
      running: !!this.io,
      metrics: { ...this.metrics },
      connections: this.connections.size,
      queues: this.messageQueue.size,
      rateLimiters: this.rateLimiters.size
    };
  }

  // Get connected clients
  getConnectedClients() {
    return Array.from(this.connections.values()).map(conn => ({
      id: conn.id,
      userId: conn.userId,
      authenticated: conn.authenticated,
      connectedAt: conn.connectedAt,
      lastActivity: conn.lastActivity,
      subscriptions: Array.from(conn.subscriptions),
      ip: conn.ip
    }));
  }

  // Shutdown service
  async shutdown() {
    console.log('🛑 Shutting down WebSocket service...');
    
    if (this.io) {
      // Notify all clients
      this.io.emit('service:shutdown', {
        message: 'Service is shutting down',
        timestamp: new Date().toISOString()
      });

      // Close all connections
      this.io.close();
    }

    // Close Redis connections
    if (this.redisAdapter) {
      await this.redisAdapter.pubClient.quit();
      await this.redisAdapter.subClient.quit();
    }

    // Clear data structures
    this.connections.clear();
    this.rooms.clear();
    this.messageQueue.clear();
    this.rateLimiters.clear();

    console.log('✅ WebSocket service shutdown complete');
    this.emit('service:shutdown');
  }

  /**
   * Event handlers - to be implemented based on business logic
   */
  async handleLogin(socket, connectionData, data) {
    // Implement authentication logic
    socket.emit('auth:success', { message: 'Login successful' });
  }

  handleLogout(socket, connectionData) {
    connectionData.authenticated = false;
    connectionData.userId = null;
    socket.emit('auth:logout', { message: 'Logged out successfully' });
  }

  handleSubscription(socket, connectionData, data) {
    const { streams } = data;
    streams.forEach(stream => {
      connectionData.subscriptions.add(stream);
    });
    socket.emit('subscription:success', { streams });
  }

  handleUnsubscription(socket, connectionData, data) {
    const { streams } = data;
    streams.forEach(stream => {
      connectionData.subscriptions.delete(stream);
    });
    socket.emit('unsubscription:success', { streams });
  }

  handleJoinRoom(socket, connectionData, data) {
    const { room } = data;
    socket.join(room);
    socket.emit('room:joined', { room });
  }

  handleLeaveRoom(socket, connectionData, data) {
    const { room } = data;
    socket.leave(room);
    socket.emit('room:left', { room });
  }

  async handleDataRequest(socket, connectionData, data) {
    // Implement data fetching logic
    socket.emit('data:response', { data: 'Sample data' });
  }

  handleMessageSend(socket, connectionData, data) {
    // Implement message routing logic
    const { room, message } = data;
    socket.to(room).emit('message:received', { from: connectionData.id, message });
  }

  handleReconnectAttempt(socket, connectionData, data) {
    connectionData.reconnectCount++;
    this.metrics.reconnections++;
    socket.emit('reconnect:success', { attempts: connectionData.reconnectCount });
  }

  handleDisconnection(clientId, reason) {
    const connection = this.connections.get(clientId);
    if (connection) {
      this.connections.delete(clientId);
      this.metrics.activeConnections--;
      
      console.log(`🔌 Client disconnected: ${clientId}`, { reason });
      this.emit('client:disconnected', { clientId, reason });
    }
  }

  // Mock data methods - replace with real implementations
  async getInventoryData(data) {
    return { inventory: 'mock data' };
  }

  async getOrderTracking(orderId) {
    return { orderId, status: 'in-transit' };
  }

  async sendDashboardData(socket, dashboardId, widgets) {
    socket.emit('dashboard:data', { dashboardId, widgets, data: 'mock data' });
  }

  async queuePersistentNotification(notification) {
    // Implement persistent notification storage
    console.log('Queued persistent notification:', notification.id);
  }
}

// Export singleton instance
export const websocketService = new WebSocketService();
export default WebSocketService;