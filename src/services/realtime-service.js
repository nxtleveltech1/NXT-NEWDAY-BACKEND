import { EventEmitter } from 'events';
import { db } from '../config/database.js';
import { sql } from 'drizzle-orm';
import queryOptimizationService from './query-optimization.service.js';

/**
 * Real-time Updates Service for Inventory
 * Implements PostgreSQL LISTEN/NOTIFY for real-time inventory updates
 * Includes WebSocket support and optimistic locking
 */

class RealtimeInventoryService extends EventEmitter {
  constructor() {
    super();
    this.connections = new Map(); // Store WebSocket connections
    this.dbNotificationClient = null;
    this.isListening = false;
  }

  /**
   * Initialize PostgreSQL LISTEN/NOTIFY for real-time updates
   */
  async initialize() {
    try {
      // Create a separate client for notifications to avoid blocking queries
      this.dbNotificationClient = await db.getClient ? await db.getClient() : null;
      
      if (this.dbNotificationClient) {
        // Listen for inventory changes
        await this.dbNotificationClient.query('LISTEN inventory_changes');
        await this.dbNotificationClient.query('LISTEN inventory_movements');
        await this.dbNotificationClient.query('LISTEN stock_alerts');

        // Set up notification handlers
        this.dbNotificationClient.on('notification', (msg) => {
          this.handleDatabaseNotification(msg);
        });

        this.isListening = true;
        console.log('Real-time inventory service initialized');
      } else {
        console.warn('Database client not available for LISTEN/NOTIFY. Using polling fallback.');
        this.setupPollingFallback();
      }
    } catch (error) {
      console.error('Error initializing realtime service:', error);
      this.setupPollingFallback();
    }
  }

  /**
   * Handle database notifications
   */
  handleDatabaseNotification(notification) {
    try {
      const { channel, payload } = notification;
      const data = JSON.parse(payload || '{}');

      switch (channel) {
        case 'inventory_changes':
          this.handleInventoryChange(data);
          break;
        case 'inventory_movements':
          this.handleInventoryMovement(data);
          break;
        case 'stock_alerts':
          this.handleStockAlert(data);
          break;
        default:
          console.log('Unhandled notification channel:', channel);
      }
    } catch (error) {
      console.error('Error handling database notification:', error);
    }
  }

  /**
   * Handle inventory level changes
   */
  handleInventoryChange(data) {
    const event = {
      type: 'inventory_change',
      timestamp: new Date().toISOString(),
      data: {
        inventoryId: data.inventory_id,
        productId: data.product_id,
        warehouseId: data.warehouse_id,
        oldQuantity: data.old_quantity,
        newQuantity: data.new_quantity,
        quantityAvailable: data.quantity_available,
        stockStatus: data.stock_status,
        changeReason: data.change_reason || 'system_update'
      }
    };

    this.emit('inventory_change', event);
    this.broadcastToSubscribers('inventory_change', event);
  }

  /**
   * Handle inventory movements
   */
  handleInventoryMovement(data) {
    const event = {
      type: 'inventory_movement',
      timestamp: new Date().toISOString(),
      data: {
        movementId: data.movement_id,
        inventoryId: data.inventory_id,
        productId: data.product_id,
        warehouseId: data.warehouse_id,
        movementType: data.movement_type,
        quantity: data.quantity,
        quantityAfter: data.quantity_after,
        performedBy: data.performed_by,
        referenceNumber: data.reference_number
      }
    };

    this.emit('inventory_movement', event);
    this.broadcastToSubscribers('inventory_movement', event);
  }

  /**
   * Handle stock alerts (low stock, out of stock, etc.)
   */
  handleStockAlert(data) {
    const event = {
      type: 'stock_alert',
      timestamp: new Date().toISOString(),
      priority: data.priority || 'medium',
      data: {
        inventoryId: data.inventory_id,
        productId: data.product_id,
        productSku: data.product_sku,
        productName: data.product_name,
        warehouseId: data.warehouse_id,
        currentQuantity: data.current_quantity,
        reorderPoint: data.reorder_point,
        alertType: data.alert_type, // 'low_stock', 'out_of_stock', 'critical_stock'
        message: data.message
      }
    };

    this.emit('stock_alert', event);
    this.broadcastToSubscribers('stock_alert', event);
  }

  /**
   * Broadcast event to all subscribed WebSocket connections
   */
  broadcastToSubscribers(eventType, eventData) {
    this.connections.forEach((connection, connectionId) => {
      if (connection.subscriptions.includes(eventType) && connection.ws.readyState === 1) {
        try {
          connection.ws.send(JSON.stringify({
            event: eventType,
            ...eventData
          }));
        } catch (error) {
          console.error(`Error sending to connection ${connectionId}:`, error);
          this.removeConnection(connectionId);
        }
      }
    });
  }

  /**
   * Add WebSocket connection for real-time updates
   */
  addConnection(connectionId, websocket, subscriptions = []) {
    this.connections.set(connectionId, {
      ws: websocket,
      subscriptions: subscriptions,
      connectedAt: new Date()
    });

    // Handle connection close
    websocket.on('close', () => {
      this.removeConnection(connectionId);
    });

    // Handle subscription updates
    websocket.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        if (data.action === 'subscribe') {
          this.updateSubscriptions(connectionId, data.events || []);
        } else if (data.action === 'unsubscribe') {
          this.removeSubscriptions(connectionId, data.events || []);
        }
      } catch (error) {
        console.error('Error handling WebSocket message:', error);
      }
    });

    console.log(`WebSocket connection ${connectionId} added`);
  }

  /**
   * Remove WebSocket connection
   */
  removeConnection(connectionId) {
    if (this.connections.has(connectionId)) {
      this.connections.delete(connectionId);
      console.log(`WebSocket connection ${connectionId} removed`);
    }
  }

  /**
   * Update subscriptions for a connection
   */
  updateSubscriptions(connectionId, newSubscriptions) {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.subscriptions = [...new Set([...connection.subscriptions, ...newSubscriptions])];
    }
  }

  /**
   * Remove subscriptions for a connection
   */
  removeSubscriptions(connectionId, subscriptionsToRemove) {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.subscriptions = connection.subscriptions.filter(
        sub => !subscriptionsToRemove.includes(sub)
      );
    }
  }

  /**
   * Trigger inventory change notification manually
   */
  async notifyInventoryChange(inventoryData) {
    try {
      if (this.dbNotificationClient) {
        const payload = JSON.stringify({
          inventory_id: inventoryData.id,
          product_id: inventoryData.productId,
          warehouse_id: inventoryData.warehouseId,
          old_quantity: inventoryData.oldQuantity,
          new_quantity: inventoryData.newQuantity,
          quantity_available: inventoryData.quantityAvailable,
          stock_status: inventoryData.stockStatus,
          change_reason: inventoryData.changeReason || 'api_update'
        });

        await this.dbNotificationClient.query('NOTIFY inventory_changes, $1', [payload]);
      } else {
        // Direct event emission if no database client
        this.handleInventoryChange({
          inventory_id: inventoryData.id,
          product_id: inventoryData.productId,
          warehouse_id: inventoryData.warehouseId,
          old_quantity: inventoryData.oldQuantity,
          new_quantity: inventoryData.newQuantity,
          quantity_available: inventoryData.quantityAvailable,
          stock_status: inventoryData.stockStatus,
          change_reason: inventoryData.changeReason || 'api_update'
        });
      }
    } catch (error) {
      console.error('Error sending inventory change notification:', error);
    }
  }

  /**
   * Trigger inventory movement notification
   */
  async notifyInventoryMovement(movementData) {
    try {
      if (this.dbNotificationClient) {
        const payload = JSON.stringify({
          movement_id: movementData.id,
          inventory_id: movementData.inventoryId,
          product_id: movementData.productId,
          warehouse_id: movementData.warehouseId,
          movement_type: movementData.movementType,
          quantity: movementData.quantity,
          quantity_after: movementData.quantityAfter,
          performed_by: movementData.performedBy,
          reference_number: movementData.referenceNumber
        });

        await this.dbNotificationClient.query('NOTIFY inventory_movements, $1', [payload]);
      } else {
        this.handleInventoryMovement(movementData);
      }
    } catch (error) {
      console.error('Error sending inventory movement notification:', error);
    }
  }

  /**
   * Trigger stock alert notification
   */
  async notifyStockAlert(alertData) {
    try {
      if (this.dbNotificationClient) {
        const payload = JSON.stringify({
          inventory_id: alertData.inventoryId,
          product_id: alertData.productId,
          product_sku: alertData.productSku,
          product_name: alertData.productName,
          warehouse_id: alertData.warehouseId,
          current_quantity: alertData.currentQuantity,
          reorder_point: alertData.reorderPoint,
          alert_type: alertData.alertType,
          priority: alertData.priority || 'medium',
          message: alertData.message
        });

        await this.dbNotificationClient.query('NOTIFY stock_alerts, $1', [payload]);
      } else {
        this.handleStockAlert(alertData);
      }
    } catch (error) {
      console.error('Error sending stock alert notification:', error);
    }
  }

  /**
   * Setup polling fallback when LISTEN/NOTIFY is not available
   */
  setupPollingFallback() {
    // CRITICAL FIX: Prevent multiple polling instances
    if (this.pollingInterval) {
      console.log('Polling fallback already active, preventing duplicate setup');
      return;
    }
    
    console.log('Setting up optimized polling fallback for real-time updates');
    
    // Memory optimization: Cache previous results to avoid redundant processing
    let lastLowStockItems = new Set();
    let pollingInterval = null;
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 5;
    const basePollingInterval = 300000; // 5 minutes instead of 30 seconds
    
    const pollForChanges = async () => {
      try {
        // Only poll if there are active connections to avoid unnecessary queries
        if (this.connections.size === 0) {
          return;
        }

        // Use optimized query service to prevent runaway queries
        const queryResult = await queryOptimizationService.getOptimizedLowStockItems({
          limit: 20,
          maxAge: 300000, // 5 minutes cache
          includeInactive: false
        });

        if (!queryResult.success) {
          throw new Error(queryResult.error || 'Query optimization service failed');
        }

        const lowStockItems = queryResult.data;
        console.log(`Query executed in ${queryResult.queryTime || 'N/A'}ms (${queryResult.source})`);

        const items = Array.isArray(lowStockItems) ? lowStockItems : [];
        const currentLowStockItems = new Set(items.map(item => `${item.inventory_id}-${item.quantity_on_hand}`));
        
        // Only process items that have changed since last check
        for (const item of items) {
          const itemKey = `${item.inventory_id}-${item.quantity_on_hand}`;
          if (!lastLowStockItems.has(itemKey)) {
            this.handleStockAlert({
              inventory_id: item.inventory_id,
              product_id: item.product_id,
              product_sku: item.sku,
              product_name: item.name,
              warehouse_id: item.warehouse_id,
              current_quantity: item.quantity_on_hand,
              reorder_point: item.reorder_point,
              alert_type: 'low_stock',
              priority: 'high',
              message: `Low stock alert: ${item.name} (${item.sku}) - ${item.quantity_on_hand} remaining`
            });
          }
        }
        
        lastLowStockItems = currentLowStockItems;
        consecutiveErrors = 0;
        
      } catch (error) {
        consecutiveErrors++;
        console.error('Error in polling fallback:', error);
        
        // Exponential backoff on consecutive errors to prevent resource exhaustion
        if (consecutiveErrors >= maxConsecutiveErrors) {
          console.warn('Too many consecutive polling errors, increasing interval');
          if (pollingInterval) {
            clearInterval(pollingInterval);
            pollingInterval = setInterval(pollForChanges, basePollingInterval * 2);
          }
        }
      }
    };
    
    // Start polling with optimized interval - prevent duplicate intervals
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }
    
    this.pollingInterval = setInterval(pollForChanges, basePollingInterval);
    console.log(`Inventory polling initialized with ${basePollingInterval/1000/60} minute interval`);
  }

  /**
   * Optimistic locking for concurrent inventory updates
   */
  async tryOptimisticLock(inventoryId, expectedVersion) {
    try {
      const result = await db.execute(sql`
        UPDATE inventory 
        SET updated_at = NOW()
        WHERE id = ${inventoryId} 
          AND updated_at = ${expectedVersion}
        RETURNING id, updated_at
      `);

      return result.length > 0 ? result[0] : null;
    } catch (error) {
      console.error('Error in optimistic lock:', error);
      return null;
    }
  }

  /**
   * Get connection statistics
   */
  getConnectionStats() {
    return {
      totalConnections: this.connections.size,
      connectionsDetail: Array.from(this.connections.entries()).map(([id, conn]) => ({
        id,
        subscriptions: conn.subscriptions,
        connectedAt: conn.connectedAt,
        isActive: conn.ws.readyState === 1
      })),
      isListening: this.isListening
    };
  }

  /**
   * Cleanup and close connections
   */
  async cleanup() {
    try {
      // Close all WebSocket connections
      this.connections.forEach((connection, connectionId) => {
        if (connection.ws.readyState === 1) {
          connection.ws.close();
        }
      });
      this.connections.clear();

      // Clear polling interval to prevent memory leaks
      if (this.pollingInterval) {
        clearInterval(this.pollingInterval);
        this.pollingInterval = null;
      }

      // Close database notification client
      if (this.dbNotificationClient) {
        await this.dbNotificationClient.end();
        this.dbNotificationClient = null;
      }

      this.isListening = false;
      console.log('Real-time inventory service cleaned up');
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }
}

// Create singleton instance
export const realtimeService = new RealtimeInventoryService();

// Export class for testing
export { RealtimeInventoryService };