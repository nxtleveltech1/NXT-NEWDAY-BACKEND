const logger = require('../utils/logger');

class WebSocketManager {
  constructor(io, eventBus) {
    this.io = io;
    this.eventBus = eventBus;
    this.connections = new Map();
    this.rooms = new Map();
    this.metrics = {
      totalConnections: 0,
      activeConnections: 0,
      messagesSent: 0,
      messagesReceived: 0,
      errors: 0
    };

    this.setupEventHandlers();
    this.setupSocketHandlers();
  }

  /**
   * Setup Socket.IO event handlers
   */
  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      this.handleConnection(socket);
    });
  }

  /**
   * Handle new socket connection
   * @param {Socket} socket - Socket.IO socket instance
   */
  handleConnection(socket) {
    const clientId = this.generateClientId();
    const clientInfo = {
      id: clientId,
      socket,
      connectedAt: new Date(),
      lastActivity: new Date(),
      subscriptions: new Set(),
      metadata: {}
    };

    this.connections.set(clientId, clientInfo);
    this.metrics.totalConnections++;
    this.metrics.activeConnections++;

    logger.info(`Client connected: ${clientId}`, {
      ip: socket.handshake.address,
      userAgent: socket.handshake.headers['user-agent']
    });

    // Setup client event handlers
    this.setupClientHandlers(socket, clientInfo);

    // Send welcome message
    socket.emit('connection:established', {
      clientId,
      timestamp: new Date(),
      features: this.getAvailableFeatures()
    });

    // Emit connection event
    this.eventBus.emit('client:connected', {
      clientId,
      ip: socket.handshake.address,
      timestamp: new Date()
    });
  }

  /**
   * Setup event handlers for a specific client
   * @param {Socket} socket - Socket.IO socket instance
   * @param {Object} clientInfo - Client information
   */
  setupClientHandlers(socket, clientInfo) {
    const { id: clientId } = clientInfo;

    // Handle authentication
    socket.on('auth:authenticate', async (data) => {
      try {
        const isAuthenticated = await this.authenticateClient(data);
        if (isAuthenticated) {
          clientInfo.authenticated = true;
          clientInfo.userId = data.userId;
          socket.emit('auth:success', { clientId });
          logger.info(`Client authenticated: ${clientId}`, { userId: data.userId });
        } else {
          socket.emit('auth:failed', { reason: 'Invalid credentials' });
          logger.warn(`Authentication failed for client: ${clientId}`);
        }
      } catch (error) {
        logger.error(`Authentication error for client ${clientId}:`, error);
        socket.emit('auth:error', { error: 'Authentication service unavailable' });
      }
    });

    // Handle subscriptions
    socket.on('subscribe', (data) => {
      this.handleSubscription(socket, clientInfo, data);
    });

    socket.on('unsubscribe', (data) => {
      this.handleUnsubscription(socket, clientInfo, data);
    });

    // Handle analytics data submission
    socket.on('analytics:submit', (data) => {
      this.handleAnalyticsSubmission(socket, clientInfo, data);
    });

    // Handle real-time queries
    socket.on('query:realtime', (data) => {
      this.handleRealtimeQuery(socket, clientInfo, data);
    });

    // Handle dashboard requests
    socket.on('dashboard:subscribe', (data) => {
      this.handleDashboardSubscription(socket, clientInfo, data);
    });

    // Handle ping/pong for connection health
    socket.on('ping', () => {
      clientInfo.lastActivity = new Date();
      socket.emit('pong', { timestamp: new Date() });
    });

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      this.handleDisconnection(clientId, reason);
    });

    // Handle errors
    socket.on('error', (error) => {
      this.metrics.errors++;
      logger.error(`Socket error for client ${clientId}:`, error);
    });

    // Update activity timestamp on any message
    socket.onAny(() => {
      clientInfo.lastActivity = new Date();
      this.metrics.messagesReceived++;
    });
  }

  /**
   * Handle client subscription to analytics streams
   * @param {Socket} socket - Socket.IO socket instance
   * @param {Object} clientInfo - Client information
   * @param {Object} data - Subscription data
   */
  handleSubscription(socket, clientInfo, data) {
    try {
      const { stream, filters = {} } = data;
      
      if (!this.isValidStream(stream)) {
        socket.emit('subscription:error', { 
          error: `Invalid stream: ${stream}`,
          availableStreams: this.getAvailableStreams()
        });
        return;
      }

      // Join appropriate room
      const roomName = this.getRoomName(stream, filters);
      socket.join(roomName);
      
      // Track subscription
      clientInfo.subscriptions.add(stream);
      
      // Store subscription details
      if (!this.rooms.has(roomName)) {
        this.rooms.set(roomName, {
          stream,
          filters,
          clients: new Set(),
          createdAt: new Date()
        });
      }
      
      this.rooms.get(roomName).clients.add(clientInfo.id);

      socket.emit('subscription:success', {
        stream,
        roomName,
        filters,
        timestamp: new Date()
      });

      logger.debug(`Client subscribed to stream: ${clientInfo.id}`, {
        stream,
        roomName,
        filters
      });

      // Send initial data if available
      this.sendInitialStreamData(socket, stream, filters);

    } catch (error) {
      logger.error(`Subscription error for client ${clientInfo.id}:`, error);
      socket.emit('subscription:error', { error: error.message });
    }
  }

  /**
   * Handle client unsubscription
   * @param {Socket} socket - Socket.IO socket instance
   * @param {Object} clientInfo - Client information
   * @param {Object} data - Unsubscription data
   */
  handleUnsubscription(socket, clientInfo, data) {
    try {
      const { stream, filters = {} } = data;
      const roomName = this.getRoomName(stream, filters);
      
      socket.leave(roomName);
      clientInfo.subscriptions.delete(stream);
      
      // Update room tracking
      if (this.rooms.has(roomName)) {
        this.rooms.get(roomName).clients.delete(clientInfo.id);
        
        // Remove room if no clients
        if (this.rooms.get(roomName).clients.size === 0) {
          this.rooms.delete(roomName);
        }
      }

      socket.emit('unsubscription:success', {
        stream,
        timestamp: new Date()
      });

      logger.debug(`Client unsubscribed from stream: ${clientInfo.id}`, { stream });

    } catch (error) {
      logger.error(`Unsubscription error for client ${clientInfo.id}:`, error);
      socket.emit('unsubscription:error', { error: error.message });
    }
  }

  /**
   * Handle analytics data submission from client
   * @param {Socket} socket - Socket.IO socket instance
   * @param {Object} clientInfo - Client information
   * @param {Object} data - Analytics data
   */
  handleAnalyticsSubmission(socket, clientInfo, data) {
    try {
      // Validate data
      if (!this.validateAnalyticsData(data)) {
        socket.emit('analytics:validation:error', { 
          error: 'Invalid analytics data format' 
        });
        return;
      }

      // Add client metadata
      const enrichedData = {
        ...data,
        clientId: clientInfo.id,
        timestamp: new Date(),
        source: 'websocket'
      };

      // Emit to analytics engine
      this.eventBus.emit('data:received', {
        type: data.type || 'general',
        payload: enrichedData
      });

      socket.emit('analytics:submitted', {
        id: this.generateSubmissionId(),
        timestamp: new Date()
      });

      logger.debug(`Analytics data submitted by client: ${clientInfo.id}`, {
        type: data.type,
        dataPoints: Array.isArray(data.payload) ? data.payload.length : 1
      });

    } catch (error) {
      logger.error(`Analytics submission error for client ${clientInfo.id}:`, error);
      socket.emit('analytics:submission:error', { error: error.message });
    }
  }

  /**
   * Handle real-time query from client
   * @param {Socket} socket - Socket.IO socket instance
   * @param {Object} clientInfo - Client information
   * @param {Object} data - Query data
   */
  async handleRealtimeQuery(socket, clientInfo, data) {
    try {
      const { query, type = 'general', parameters = {} } = data;
      const queryId = this.generateQueryId();

      logger.debug(`Real-time query from client: ${clientInfo.id}`, { query, type });

      // Execute query through analytics engine
      this.eventBus.emit('query:realtime', {
        queryId,
        clientId: clientInfo.id,
        query,
        type,
        parameters,
        responseChannel: `query:response:${queryId}`
      });

      // Listen for response
      const responseHandler = (response) => {
        socket.emit('query:response', {
          queryId,
          ...response,
          timestamp: new Date()
        });
      };

      this.eventBus.once(`query:response:${queryId}`, responseHandler);

      // Set timeout for query
      setTimeout(() => {
        this.eventBus.removeListener(`query:response:${queryId}`, responseHandler);
        socket.emit('query:timeout', {
          queryId,
          error: 'Query timeout',
          timestamp: new Date()
        });
      }, 30000); // 30 second timeout

    } catch (error) {
      logger.error(`Real-time query error for client ${clientInfo.id}:`, error);
      socket.emit('query:error', { error: error.message });
    }
  }

  /**
   * Handle dashboard subscription
   * @param {Socket} socket - Socket.IO socket instance
   * @param {Object} clientInfo - Client information
   * @param {Object} data - Dashboard subscription data
   */
  handleDashboardSubscription(socket, clientInfo, data) {
    try {
      const { dashboardId, widgets = [] } = data;
      
      // Subscribe to dashboard updates
      this.handleSubscription(socket, clientInfo, {
        stream: 'dashboard',
        filters: { dashboardId, widgets }
      });

      // Send current dashboard state
      this.eventBus.emit('dashboard:state:request', {
        dashboardId,
        clientId: clientInfo.id,
        responseChannel: `dashboard:state:${clientInfo.id}`
      });

      // Listen for dashboard state response
      this.eventBus.once(`dashboard:state:${clientInfo.id}`, (state) => {
        socket.emit('dashboard:state', {
          dashboardId,
          state,
          timestamp: new Date()
        });
      });

    } catch (error) {
      logger.error(`Dashboard subscription error for client ${clientInfo.id}:`, error);
      socket.emit('dashboard:subscription:error', { error: error.message });
    }
  }

  /**
   * Handle client disconnection
   * @param {string} clientId - Client ID
   * @param {string} reason - Disconnection reason
   */
  handleDisconnection(clientId, reason) {
    const clientInfo = this.connections.get(clientId);
    
    if (clientInfo) {
      // Update metrics
      this.metrics.activeConnections--;
      
      // Clean up room memberships
      for (const [roomName, room] of this.rooms.entries()) {
        if (room.clients.has(clientId)) {
          room.clients.delete(clientId);
          
          // Remove empty rooms
          if (room.clients.size === 0) {
            this.rooms.delete(roomName);
          }
        }
      }
      
      // Remove from connections
      this.connections.delete(clientId);
      
      logger.info(`Client disconnected: ${clientId}`, { reason });
      
      // Emit disconnection event
      this.eventBus.emit('client:disconnected', {
        clientId,
        reason,
        timestamp: new Date(),
        sessionDuration: new Date() - clientInfo.connectedAt
      });
    }
  }

  /**
   * Setup event bus handlers for analytics events
   */
  setupEventHandlers() {
    // Analytics processed
    this.eventBus.on('analytics:processed', (data) => {
      this.broadcastToStream('analytics', data);
    });

    // New insights
    this.eventBus.on('insight:generated', (insight) => {
      this.broadcastToStream('insights', insight);
    });

    // Predictions ready
    this.eventBus.on('prediction:ready', (prediction) => {
      this.broadcastToStream('predictions', prediction);
    });

    // Critical alerts
    this.eventBus.on('alert:triggered', (alert) => {
      this.broadcastToStream('alerts', alert, true); // High priority
    });

    // Dashboard updates
    this.eventBus.on('dashboard:update', (update) => {
      this.broadcastToDashboard(update.dashboardId, update);
    });

    // Performance metrics
    this.eventBus.on('performance:metrics', (metrics) => {
      this.broadcastToStream('performance', metrics);
    });
  }

  /**
   * Broadcast data to specific stream
   * @param {string} stream - Stream name
   * @param {Object} data - Data to broadcast
   * @param {boolean} highPriority - Whether this is high priority
   */
  broadcastToStream(stream, data, highPriority = false) {
    try {
      // Find all rooms for this stream
      const streamRooms = Array.from(this.rooms.keys()).filter(roomName => 
        roomName.startsWith(`${stream}:`)
      );

      for (const roomName of streamRooms) {
        const room = this.rooms.get(roomName);
        
        // Apply filters if any
        if (this.matchesFilters(data, room.filters)) {
          const eventName = highPriority ? `${stream}:priority` : `${stream}:update`;
          
          this.io.to(roomName).emit(eventName, {
            ...data,
            timestamp: new Date(),
            stream
          });

          this.metrics.messagesSent += room.clients.size;
        }
      }

      logger.debug(`Broadcasted to stream: ${stream}`, {
        rooms: streamRooms.length,
        highPriority
      });

    } catch (error) {
      logger.error(`Error broadcasting to stream ${stream}:`, error);
    }
  }

  /**
   * Broadcast to all connected clients
   * @param {string} event - Event name
   * @param {Object} data - Data to broadcast
   */
  broadcast(event, data) {
    try {
      this.io.emit(event, {
        ...data,
        timestamp: new Date()
      });

      this.metrics.messagesSent += this.metrics.activeConnections;

      logger.debug(`Broadcasted event: ${event}`, {
        clients: this.metrics.activeConnections
      });

    } catch (error) {
      logger.error(`Error broadcasting event ${event}:`, error);
    }
  }

  /**
   * Send message to specific client
   * @param {string} clientId - Client ID
   * @param {string} event - Event name
   * @param {Object} data - Data to send
   */
  sendToClient(clientId, event, data) {
    try {
      const clientInfo = this.connections.get(clientId);
      
      if (clientInfo) {
        clientInfo.socket.emit(event, {
          ...data,
          timestamp: new Date()
        });

        this.metrics.messagesSent++;

        logger.debug(`Sent message to client: ${clientId}`, { event });
      } else {
        logger.warn(`Client not found: ${clientId}`);
      }

    } catch (error) {
      logger.error(`Error sending message to client ${clientId}:`, error);
    }
  }

  /**
   * Broadcast to specific dashboard
   * @param {string} dashboardId - Dashboard ID
   * @param {Object} update - Update data
   */
  broadcastToDashboard(dashboardId, update) {
    const roomName = `dashboard:${dashboardId}`;
    
    this.io.to(roomName).emit('dashboard:update', {
      dashboardId,
      ...update,
      timestamp: new Date()
    });
  }

  /**
   * Get WebSocket manager metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      rooms: this.rooms.size,
      uptime: process.uptime()
    };
  }

  /**
   * Get connected clients information
   */
  getConnectedClients() {
    const clients = [];
    
    for (const [clientId, clientInfo] of this.connections.entries()) {
      clients.push({
        id: clientId,
        connectedAt: clientInfo.connectedAt,
        lastActivity: clientInfo.lastActivity,
        authenticated: clientInfo.authenticated || false,
        subscriptions: Array.from(clientInfo.subscriptions),
        userId: clientInfo.userId
      });
    }
    
    return clients;
  }

  /**
   * Close all connections
   */
  closeAll() {
    logger.info('Closing all WebSocket connections...');
    
    for (const [clientId, clientInfo] of this.connections.entries()) {
      clientInfo.socket.disconnect(true);
    }
    
    this.connections.clear();
    this.rooms.clear();
    this.metrics.activeConnections = 0;
    
    logger.info('All WebSocket connections closed');
  }

  // Helper methods

  generateClientId() {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  generateSubmissionId() {
    return `submission_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  generateQueryId() {
    return `query_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  getRoomName(stream, filters) {
    const filterHash = Object.keys(filters).length > 0 ? 
      Buffer.from(JSON.stringify(filters)).toString('base64').substr(0, 8) : 
      'default';
    
    return `${stream}:${filterHash}`;
  }

  isValidStream(stream) {
    const validStreams = [
      'analytics', 'insights', 'predictions', 'alerts', 
      'performance', 'dashboard', 'user-behavior'
    ];
    return validStreams.includes(stream);
  }

  getAvailableStreams() {
    return [
      'analytics', 'insights', 'predictions', 'alerts', 
      'performance', 'dashboard', 'user-behavior'
    ];
  }

  getAvailableFeatures() {
    return [
      'real-time-analytics', 'live-dashboards', 'predictive-insights',
      'alert-notifications', 'performance-monitoring', 'custom-queries'
    ];
  }

  validateAnalyticsData(data) {
    return data && typeof data === 'object' && data.payload;
  }

  matchesFilters(data, filters) {
    // Simple filter matching - can be extended
    if (!filters || Object.keys(filters).length === 0) {
      return true;
    }

    for (const [key, value] of Object.entries(filters)) {
      if (data[key] !== value) {
        return false;
      }
    }

    return true;
  }

  async authenticateClient(data) {
    // Placeholder authentication logic
    // In real implementation, this would validate JWT tokens, API keys, etc.
    return data && data.token && data.token.length > 0;
  }

  async sendInitialStreamData(socket, stream, filters) {
    // Send initial data for the stream if available
    // This would typically fetch recent data from cache or database
    logger.debug(`Sending initial data for stream: ${stream}`);
  }
}

module.exports = WebSocketManager;