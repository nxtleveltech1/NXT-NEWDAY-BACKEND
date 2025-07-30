import { WebSocketServer } from 'ws';
import { getEnhancedUploadQueue } from './upload-queue-enhanced.js';

// WebSocket message types
export const WS_MESSAGE_TYPES = {
  // Client -> Server
  SUBSCRIBE: 'subscribe',
  UNSUBSCRIBE: 'unsubscribe',
  GET_STATUS: 'get_status',
  GET_QUEUE_STATS: 'get_queue_stats',
  CANCEL_UPLOAD: 'cancel_upload',
  PAUSE_UPLOAD: 'pause_upload',
  RESUME_UPLOAD: 'resume_upload',
  REQUEUE_UPLOAD: 'requeue_upload',
  PING: 'ping',
  
  // Server -> Client
  CONNECTION: 'connection',
  SUBSCRIBED: 'subscribed',
  UNSUBSCRIBED: 'unsubscribed',
  UPLOAD_QUEUED: 'upload:queued',
  UPLOAD_STARTED: 'upload:started',
  UPLOAD_PROGRESS: 'upload:progress',
  UPLOAD_COMPLETED: 'upload:completed',
  UPLOAD_FAILED: 'upload:failed',
  UPLOAD_CANCELLED: 'upload:cancelled',
  UPLOAD_CONFLICT: 'upload:conflict',
  UPLOAD_RETRY: 'upload:retry',
  UPLOAD_PAUSED: 'upload:paused',
  UPLOAD_RESUMED: 'upload:resumed',
  QUEUE_STATS: 'queue:stats',
  QUEUE_HEALTH: 'queue:health',
  ERROR: 'error',
  PONG: 'pong'
};

// WebSocket handler class for upload queue
export class UploadWebSocketHandler {
  constructor(options = {}) {
    this.port = options.port || 4001;
    this.host = options.host || '0.0.0.0';
    this.uploadQueue = options.uploadQueue || getEnhancedUploadQueue();
    this.clients = new Map();
    this.heartbeatInterval = options.heartbeatInterval || 30000; // 30 seconds
    this.statsInterval = options.statsInterval || 10000; // 10 seconds
  }
  
  // Start WebSocket server
  async start() {
    this.wss = new WebSocketServer({
      port: this.port,
      host: this.host,
      perMessageDeflate: {
        zlibDeflateOptions: {
          chunkSize: 1024,
          memLevel: 7,
          level: 3
        },
        zlibInflateOptions: {
          chunkSize: 10 * 1024
        },
        clientNoContextTakeover: true,
        serverNoContextTakeover: true,
        serverMaxWindowBits: 10,
        concurrencyLimit: 10,
        threshold: 1024
      }
    });
    
    this.wss.on('connection', (ws, req) => {
      this.handleConnection(ws, req);
    });
    
    this.wss.on('error', (error) => {
      console.error('WebSocket server error:', error);
    });
    
    // Start heartbeat check
    this.startHeartbeat();
    
    // Start stats broadcast
    this.startStatsBroadcast();
    
    // Set up upload queue event listeners
    this.setupQueueListeners();
    
    console.log(`Upload WebSocket server started on ${this.host}:${this.port}`);
  }
  
  // Handle new WebSocket connection
  handleConnection(ws, req) {
    const clientId = this.generateClientId();
    const clientInfo = {
      id: clientId,
      ws,
      subscriptions: new Set(),
      suppliers: new Set(),
      connectedAt: new Date(),
      lastActivity: new Date(),
      isAlive: true,
      remoteAddress: req.socket.remoteAddress,
      userAgent: req.headers['user-agent']
    };
    
    this.clients.set(clientId, clientInfo);
    
    // Send welcome message
    this.sendToClient(ws, {
      type: WS_MESSAGE_TYPES.CONNECTION,
      clientId,
      serverTime: new Date(),
      features: {
        realtimeProgress: true,
        queueManagement: true,
        conflictResolution: true,
        statistics: true
      }
    });
    
    // Set up client event handlers
    ws.on('message', (message) => {
      this.handleClientMessage(clientInfo, message);
    });
    
    ws.on('close', () => {
      this.handleClientDisconnect(clientInfo);
    });
    
    ws.on('error', (error) => {
      console.error(`WebSocket client ${clientId} error:`, error);
    });
    
    ws.on('pong', () => {
      clientInfo.isAlive = true;
      clientInfo.lastActivity = new Date();
    });
    
    console.log(`WebSocket client connected: ${clientId} from ${clientInfo.remoteAddress}`);
  }
  
  // Handle client message
  async handleClientMessage(clientInfo, message) {
    try {
      const data = JSON.parse(message);
      clientInfo.lastActivity = new Date();
      
      switch (data.type) {
        case WS_MESSAGE_TYPES.SUBSCRIBE:
          await this.handleSubscribe(clientInfo, data);
          break;
          
        case WS_MESSAGE_TYPES.UNSUBSCRIBE:
          await this.handleUnsubscribe(clientInfo, data);
          break;
          
        case WS_MESSAGE_TYPES.GET_STATUS:
          await this.handleGetStatus(clientInfo, data);
          break;
          
        case WS_MESSAGE_TYPES.GET_QUEUE_STATS:
          await this.handleGetQueueStats(clientInfo, data);
          break;
          
        case WS_MESSAGE_TYPES.CANCEL_UPLOAD:
          await this.handleCancelUpload(clientInfo, data);
          break;
          
        case WS_MESSAGE_TYPES.PAUSE_UPLOAD:
          await this.handlePauseUpload(clientInfo, data);
          break;
          
        case WS_MESSAGE_TYPES.RESUME_UPLOAD:
          await this.handleResumeUpload(clientInfo, data);
          break;
          
        case WS_MESSAGE_TYPES.REQUEUE_UPLOAD:
          await this.handleRequeueUpload(clientInfo, data);
          break;
          
        case WS_MESSAGE_TYPES.PING:
          this.sendToClient(clientInfo.ws, { type: WS_MESSAGE_TYPES.PONG });
          break;
          
        default:
          this.sendError(clientInfo.ws, 'Unknown message type');
      }
    } catch (error) {
      console.error('Error handling client message:', error);
      this.sendError(clientInfo.ws, 'Invalid message format');
    }
  }
  
  // Handle subscription request
  async handleSubscribe(clientInfo, data) {
    if (data.supplierId) {
      clientInfo.suppliers.add(data.supplierId);
      this.sendToClient(clientInfo.ws, {
        type: WS_MESSAGE_TYPES.SUBSCRIBED,
        supplierId: data.supplierId
      });
    }
    
    if (data.uploadId) {
      clientInfo.subscriptions.add(data.uploadId);
      
      // Send current status if available
      const status = await this.uploadQueue.getUploadStatus(data.uploadId);
      if (status) {
        this.sendToClient(clientInfo.ws, {
          type: 'upload:status',
          uploadId: data.uploadId,
          status
        });
      }
    }
  }
  
  // Handle unsubscribe request
  async handleUnsubscribe(clientInfo, data) {
    if (data.supplierId) {
      clientInfo.suppliers.delete(data.supplierId);
      this.sendToClient(clientInfo.ws, {
        type: WS_MESSAGE_TYPES.UNSUBSCRIBED,
        supplierId: data.supplierId
      });
    }
    
    if (data.uploadId) {
      clientInfo.subscriptions.delete(data.uploadId);
    }
  }
  
  // Handle get status request
  async handleGetStatus(clientInfo, data) {
    if (!data.uploadId) {
      this.sendError(clientInfo.ws, 'Upload ID required');
      return;
    }
    
    const status = await this.uploadQueue.getUploadStatus(data.uploadId);
    if (status) {
      this.sendToClient(clientInfo.ws, {
        type: 'upload:status',
        uploadId: data.uploadId,
        status
      });
    } else {
      this.sendError(clientInfo.ws, 'Upload not found');
    }
  }
  
  // Handle get queue stats request
  async handleGetQueueStats(clientInfo, data) {
    const stats = await this.uploadQueue.getStatistics();
    const health = await this.uploadQueue.getHealthStatus();
    
    this.sendToClient(clientInfo.ws, {
      type: WS_MESSAGE_TYPES.QUEUE_STATS,
      stats,
      health
    });
  }
  
  // Handle cancel upload request
  async handleCancelUpload(clientInfo, data) {
    if (!data.uploadId) {
      this.sendError(clientInfo.ws, 'Upload ID required');
      return;
    }
    
    const result = await this.uploadQueue.cancelUpload(data.uploadId, data.reason);
    this.sendToClient(clientInfo.ws, {
      type: 'upload:cancel_result',
      uploadId: data.uploadId,
      result
    });
  }
  
  // Handle pause upload request
  async handlePauseUpload(clientInfo, data) {
    if (!data.uploadId) {
      this.sendError(clientInfo.ws, 'Upload ID required');
      return;
    }
    
    const result = await this.uploadQueue.pauseUpload(data.uploadId);
    this.sendToClient(clientInfo.ws, {
      type: 'upload:pause_result',
      uploadId: data.uploadId,
      result
    });
  }
  
  // Handle resume upload request
  async handleResumeUpload(clientInfo, data) {
    if (!data.uploadId) {
      this.sendError(clientInfo.ws, 'Upload ID required');
      return;
    }
    
    const result = await this.uploadQueue.resumeUpload(data.uploadId);
    this.sendToClient(clientInfo.ws, {
      type: 'upload:resume_result',
      uploadId: data.uploadId,
      result
    });
  }
  
  // Handle requeue upload request
  async handleRequeueUpload(clientInfo, data) {
    if (!data.uploadId) {
      this.sendError(clientInfo.ws, 'Upload ID required');
      return;
    }
    
    const result = await this.uploadQueue.requeueFailedUpload(data.uploadId, data.options);
    this.sendToClient(clientInfo.ws, {
      type: 'upload:requeue_result',
      uploadId: data.uploadId,
      result
    });
  }
  
  // Handle client disconnect
  handleClientDisconnect(clientInfo) {
    console.log(`WebSocket client disconnected: ${clientInfo.id}`);
    this.clients.delete(clientInfo.id);
  }
  
  // Set up upload queue event listeners
  setupQueueListeners() {
    // Upload queued
    this.uploadQueue.on('upload:queued', (upload) => {
      this.broadcastToSupplier(upload.supplierId, {
        type: WS_MESSAGE_TYPES.UPLOAD_QUEUED,
        upload: this.sanitizeUpload(upload)
      });
    });
    
    // Upload started
    this.uploadQueue.on('upload:started', (upload) => {
      this.broadcastToSupplier(upload.supplierId, {
        type: WS_MESSAGE_TYPES.UPLOAD_STARTED,
        upload: this.sanitizeUpload(upload)
      });
    });
    
    // Upload progress
    this.uploadQueue.on('upload:progress', (data) => {
      this.broadcastToUpload(data.uploadId, {
        type: WS_MESSAGE_TYPES.UPLOAD_PROGRESS,
        ...data
      });
    });
    
    // Upload completed
    this.uploadQueue.on('upload:completed', (upload) => {
      this.broadcastToSupplier(upload.supplierId, {
        type: WS_MESSAGE_TYPES.UPLOAD_COMPLETED,
        upload: this.sanitizeUpload(upload)
      });
    });
    
    // Upload failed
    this.uploadQueue.on('upload:failed', (upload) => {
      this.broadcastToSupplier(upload.supplierId, {
        type: WS_MESSAGE_TYPES.UPLOAD_FAILED,
        upload: this.sanitizeUpload(upload)
      });
    });
    
    // Upload cancelled
    this.uploadQueue.on('upload:cancelled', (upload) => {
      this.broadcastToSupplier(upload.supplierId, {
        type: WS_MESSAGE_TYPES.UPLOAD_CANCELLED,
        upload: this.sanitizeUpload(upload)
      });
    });
    
    // Upload conflict
    this.uploadQueue.on('upload:conflict', (upload) => {
      this.broadcastToSupplier(upload.supplierId, {
        type: WS_MESSAGE_TYPES.UPLOAD_CONFLICT,
        upload: this.sanitizeUpload(upload)
      });
    });
    
    // Upload retry
    this.uploadQueue.on('upload:retry', (data) => {
      this.broadcastToSupplier(data.upload.supplierId, {
        type: WS_MESSAGE_TYPES.UPLOAD_RETRY,
        upload: this.sanitizeUpload(data.upload),
        attempt: data.attempt,
        nextAttempt: data.nextAttempt
      });
    });
  }
  
  // Broadcast to clients subscribed to a supplier
  broadcastToSupplier(supplierId, message) {
    const messageStr = JSON.stringify({
      ...message,
      timestamp: new Date()
    });
    
    this.clients.forEach(clientInfo => {
      if (clientInfo.ws.readyState === 1 && // WebSocket.OPEN
          clientInfo.suppliers.has(supplierId)) {
        clientInfo.ws.send(messageStr);
      }
    });
  }
  
  // Broadcast to clients subscribed to a specific upload
  broadcastToUpload(uploadId, message) {
    const messageStr = JSON.stringify({
      ...message,
      timestamp: new Date()
    });
    
    this.clients.forEach(clientInfo => {
      if (clientInfo.ws.readyState === 1 && // WebSocket.OPEN
          clientInfo.subscriptions.has(uploadId)) {
        clientInfo.ws.send(messageStr);
      }
    });
  }
  
  // Broadcast to all connected clients
  broadcastToAll(message) {
    const messageStr = JSON.stringify({
      ...message,
      timestamp: new Date()
    });
    
    this.clients.forEach(clientInfo => {
      if (clientInfo.ws.readyState === 1) { // WebSocket.OPEN
        clientInfo.ws.send(messageStr);
      }
    });
  }
  
  // Send message to specific client
  sendToClient(ws, message) {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(JSON.stringify({
        ...message,
        timestamp: new Date()
      }));
    }
  }
  
  // Send error message to client
  sendError(ws, error) {
    this.sendToClient(ws, {
      type: WS_MESSAGE_TYPES.ERROR,
      error: typeof error === 'string' ? error : error.message
    });
  }
  
  // Sanitize upload data before sending to client
  sanitizeUpload(upload) {
    const sanitized = { ...upload };
    
    // Remove sensitive data
    delete sanitized.processor;
    delete sanitized.data;
    
    // Remove file buffer if present
    if (sanitized.file && sanitized.file.buffer) {
      sanitized.file = {
        originalname: sanitized.file.originalname,
        mimetype: sanitized.file.mimetype,
        size: sanitized.file.size
      };
    }
    
    return sanitized;
  }
  
  // Start heartbeat interval
  startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      this.clients.forEach(clientInfo => {
        if (!clientInfo.isAlive) {
          // Client didn't respond to last ping, terminate
          console.log(`Terminating inactive client: ${clientInfo.id}`);
          clientInfo.ws.terminate();
          this.clients.delete(clientInfo.id);
        } else {
          // Send ping
          clientInfo.isAlive = false;
          clientInfo.ws.ping();
        }
      });
    }, this.heartbeatInterval);
  }
  
  // Start stats broadcast interval
  startStatsBroadcast() {
    this.statsTimer = setInterval(async () => {
      if (this.clients.size > 0) {
        const stats = await this.uploadQueue.getStatistics();
        const health = await this.uploadQueue.getHealthStatus();
        
        this.broadcastToAll({
          type: WS_MESSAGE_TYPES.QUEUE_STATS,
          stats: {
            queue: stats.queue,
            processing: stats.processing,
            performance: stats.performance
          },
          health: health.status
        });
      }
    }, this.statsInterval);
  }
  
  // Generate unique client ID
  generateClientId() {
    return `ws_client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  // Get connected clients info
  getClientsInfo() {
    const info = [];
    
    this.clients.forEach(clientInfo => {
      info.push({
        id: clientInfo.id,
        connectedAt: clientInfo.connectedAt,
        lastActivity: clientInfo.lastActivity,
        suppliers: Array.from(clientInfo.suppliers),
        subscriptions: Array.from(clientInfo.subscriptions),
        remoteAddress: clientInfo.remoteAddress
      });
    });
    
    return info;
  }
  
  // Stop WebSocket server
  async stop() {
    // Clear intervals
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
    }
    
    // Notify all clients
    this.broadcastToAll({
      type: 'server:shutdown',
      message: 'WebSocket server is shutting down'
    });
    
    // Close all connections
    this.clients.forEach(clientInfo => {
      clientInfo.ws.close();
    });
    
    // Close server
    if (this.wss) {
      await new Promise((resolve) => {
        this.wss.close(resolve);
      });
    }
    
    console.log('Upload WebSocket server stopped');
  }
}

// Create and export singleton instance
let wsHandler = null;

export function getUploadWebSocketHandler(options) {
  if (!wsHandler) {
    wsHandler = new UploadWebSocketHandler(options);
  }
  return wsHandler;
}

// Start WebSocket server if this module is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const handler = getUploadWebSocketHandler();
  handler.start().catch(console.error);
}