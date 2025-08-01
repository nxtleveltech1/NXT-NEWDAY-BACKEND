/**
 * Enhanced WebSocket Handler for Upload Progress
 * Provides real-time updates for supplier upload operations
 */

import { WebSocketServer } from 'ws';
import { EventEmitter } from 'events';

export class UploadWebSocketHandler extends EventEmitter {
  constructor(server) {
    super();
    this.wss = new WebSocketServer({ server });
    this.clients = new Map(); // sessionId -> WebSocket connection
    this.uploadSessions = new Map(); // uploadId -> session data
    
    this.setupWebSocketServer();
    console.log('🔌 Upload WebSocket server initialized');
  }

  setupWebSocketServer() {
    this.wss.on('connection', (ws, req) => {
      console.log('📡 New WebSocket connection established');
      
      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          this.handleMessage(ws, data);
        } catch (error) {
          console.error('Invalid WebSocket message:', error);
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Invalid message format'
          }));
        }
      });

      ws.on('close', () => {
        // Remove client from active sessions
        for (const [sessionId, client] of this.clients.entries()) {
          if (client === ws) {
            this.clients.delete(sessionId);
            console.log(`🔌 WebSocket client disconnected: ${sessionId}`);
            break;
          }
        }
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
      });

      // Send welcome message
      ws.send(JSON.stringify({
        type: 'connected',
        message: 'WebSocket connection established',
        timestamp: new Date().toISOString()
      }));
    });
  }

  handleMessage(ws, data) {
    switch (data.type) {
      case 'subscribe_upload':
        this.subscribeToUpload(ws, data.uploadId, data.sessionId);
        break;
        
      case 'unsubscribe_upload':
        this.unsubscribeFromUpload(data.sessionId);
        break;
        
      case 'get_upload_status':
        this.sendUploadStatus(ws, data.uploadId);
        break;
        
      default:
        ws.send(JSON.stringify({
          type: 'error',
          message: `Unknown message type: ${data.type}`
        }));
    }
  }

  subscribeToUpload(ws, uploadId, sessionId) {
    if (sessionId) {
      this.clients.set(sessionId, ws);
      console.log(`📡 Client subscribed to upload: ${uploadId} (session: ${sessionId})`);
      
      // Send current status if available
      const session = this.uploadSessions.get(uploadId);
      if (session) {
        ws.send(JSON.stringify({
          type: 'upload_status',
          data: session
        }));
      }
      
      ws.send(JSON.stringify({
        type: 'subscribed',
        uploadId,
        sessionId,
        message: 'Successfully subscribed to upload progress'
      }));
    }
  }

  unsubscribeFromUpload(sessionId) {
    if (this.clients.has(sessionId)) {
      this.clients.delete(sessionId);
      console.log(`📡 Client unsubscribed: ${sessionId}`);
    }
  }

  sendUploadStatus(ws, uploadId) {
    const session = this.uploadSessions.get(uploadId);
    
    ws.send(JSON.stringify({
      type: 'upload_status',
      uploadId,
      data: session || {
        status: 'not_found',
        message: 'Upload session not found'
      }
    }));
  }

  // Public methods for upload progress updates
  
  /**
   * Start tracking an upload session
   */
  startUploadSession(uploadId, sessionData) {
    this.uploadSessions.set(uploadId, {
      ...sessionData,
      startTime: new Date(),
      progress: 0,
      status: 'started'
    });
    
    this.broadcastToUpload(uploadId, {
      type: 'upload_started',
      data: this.uploadSessions.get(uploadId)
    });
    
    console.log(`📡 Started tracking upload session: ${uploadId}`);
  }

  /**
   * Update upload progress
   */
  updateUploadProgress(uploadId, progress, currentStep, message = '') {
    const session = this.uploadSessions.get(uploadId);
    if (session) {
      session.progress = Math.min(100, Math.max(0, progress));
      session.currentStep = currentStep;
      session.message = message;
      session.lastUpdate = new Date();
      
      this.broadcastToUpload(uploadId, {
        type: 'upload_progress',
        data: {
          uploadId,
          progress: session.progress,
          currentStep,
          message,
          timestamp: session.lastUpdate
        }
      });
    }
  }

  /**
   * Complete upload session
   */
  completeUploadSession(uploadId, result) {
    const session = this.uploadSessions.get(uploadId);
    if (session) {
      session.status = result.success ? 'completed' : 'failed';
      session.progress = 100;
      session.completedAt = new Date();
      session.result = result;
      
      this.broadcastToUpload(uploadId, {
        type: 'upload_completed',
        data: {
          uploadId,
          status: session.status,
          result,
          duration: session.completedAt - session.startTime,
          timestamp: session.completedAt
        }
      });
      
      // Clean up session after a short delay
      setTimeout(() => {
        this.uploadSessions.delete(uploadId);
      }, 30000); // Keep for 30 seconds for final status checks
    }
  }

  /**
   * Handle upload errors
   */
  handleUploadError(uploadId, error) {
    const session = this.uploadSessions.get(uploadId);
    if (session) {
      session.status = 'failed';
      session.error = error;
      session.completedAt = new Date();
      
      this.broadcastToUpload(uploadId, {
        type: 'upload_error',
        data: {
          uploadId,
          error: {
            message: error.message,
            code: error.code || 'UPLOAD_ERROR'
          },
          timestamp: session.completedAt
        }
      });
    }
  }

  /**
   * Send validation results
   */
  sendValidationResults(uploadId, validationResults) {
    this.broadcastToUpload(uploadId, {
      type: 'validation_results',
      data: {
        uploadId,
        validation: validationResults,
        timestamp: new Date()
      }
    });
  }

  /**
   * Send preview data for approval
   */
  sendPreviewData(uploadId, previewData) {
    this.broadcastToUpload(uploadId, {
      type: 'preview_ready',
      data: {
        uploadId,
        preview: previewData,
        requiresApproval: true,
        timestamp: new Date()
      }
    });
  }

  /**
   * Broadcast message to all clients subscribed to an upload
   */
  broadcastToUpload(uploadId, message) {
    for (const [sessionId, ws] of this.clients.entries()) {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.send(JSON.stringify(message));
        } catch (error) {
          console.error(`Failed to send message to client ${sessionId}:`, error);
          this.clients.delete(sessionId);
        }
      } else {
        this.clients.delete(sessionId);
      }
    }
  }

  /**
   * Get active session count
   */
  getActiveSessionCount() {
    return this.uploadSessions.size;
  }

  /**
   * Get connected client count
   */
  getConnectedClientCount() {
    // Clean up closed connections
    for (const [sessionId, ws] of this.clients.entries()) {
      if (ws.readyState !== ws.OPEN) {
        this.clients.delete(sessionId);
      }
    }
    
    return this.clients.size;
  }

  /**
   * Send supplier notification through WebSocket
   */
  sendSupplierNotification(supplierId, notification) {
    const message = {
      type: 'supplier_notification',
      supplierId,
      notificationType: notification.type,
      data: notification.data,
      timestamp: new Date()
    };

    // Broadcast to all connected clients (in a real app, would filter by supplier)
    this.broadcastToAll(message);
  }

  /**
   * Broadcast to all connected clients
   */
  broadcastToAll(message) {
    for (const [sessionId, ws] of this.clients.entries()) {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.send(JSON.stringify(message));
        } catch (error) {
          console.error(`Failed to broadcast to client ${sessionId}:`, error);
          this.clients.delete(sessionId);
        }
      } else {
        this.clients.delete(sessionId);
      }
    }
  }

  /**
   * Get upload session statistics
   */
  getSessionStatistics() {
    return {
      activeSessions: this.uploadSessions.size,
      connectedClients: this.getConnectedClientCount(),
      totalConnections: this.wss.clients.size,
      uptime: process.uptime()
    };
  }
}

// Export singleton instance
let instance = null;

export function initializeUploadWebSocket(server) {
  if (!instance) {
    instance = new UploadWebSocketHandler(server);
  }
  return instance;
}

export function getUploadWebSocket() {
  return instance;
}

export default UploadWebSocketHandler;