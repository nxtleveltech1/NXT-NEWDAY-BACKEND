import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, jest } from '@jest/globals';
import { EventEmitter } from 'events';
import { RealtimeInventoryService, realtimeService } from '../realtime-service.js';
import { db } from '../../config/database.js';
import { sql } from 'drizzle-orm';

// Skipped: requires mocking, not allowed in integration-only test policy.


describe.skip('RealtimeInventoryService', () => {
  let service;
  let mockWebSocket;
  let mockDbClient;

  const mockInventoryChangeData = {
    id: 'inv-123',
    productId: 'prod-456',
    warehouseId: 'wh-001',
    oldQuantity: 100,
    newQuantity: 90,
    quantityAvailable: 70,
    stockStatus: 'in_stock',
    changeReason: 'sale'
  };

  const mockMovementData = {
    id: 'mov-001',
    inventoryId: 'inv-123',
    productId: 'prod-456',
    warehouseId: 'wh-001',
    movementType: 'sale',
    quantity: -10,
    quantityAfter: 90,
    performedBy: 'user-001',
    referenceNumber: 'ORD-2024-001'
  };

  const mockStockAlertData = {
    inventoryId: 'inv-123',
    productId: 'prod-456',
    productSku: 'TEST-001',
    productName: 'Test Product',
    warehouseId: 'wh-001',
    currentQuantity: 20,
    reorderPoint: 50,
    alertType: 'low_stock',
    priority: 'high',
    message: 'Low stock alert: Test Product (TEST-001) - 20 remaining'
  };

  beforeAll(() => {
    // Mock WebSocket
    mockWebSocket = {
      readyState: 1, // OPEN
      send: jest.fn(),
      close: jest.fn(),
      on: jest.fn()
    };

    // Mock database client
    mockDbClient = {
      query: jest.fn(),
      on: jest.fn(),
      end: jest.fn()
    };

    // Mock database
    db.getClient = jest.fn().mockResolvedValue(mockDbClient);
    db.execute = jest.fn();
  });

  beforeEach(() => {
    service = new RealtimeInventoryService();
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    service.cleanup();
    jest.restoreAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize with PostgreSQL LISTEN/NOTIFY successfully', async () => {
      await service.initialize();

      expect(mockDbClient.query).toHaveBeenCalledWith('LISTEN inventory_changes');
      expect(mockDbClient.query).toHaveBeenCalledWith('LISTEN inventory_movements');
      expect(mockDbClient.query).toHaveBeenCalledWith('LISTEN stock_alerts');
      expect(mockDbClient.on).toHaveBeenCalledWith('notification', expect.any(Function));
      expect(service.isListening).toBe(true);
    });

    it('should fall back to polling when database client unavailable', async () => {
      db.getClient = jest.fn().mockResolvedValue(null);
      jest.spyOn(service, 'setupPollingFallback').mockImplementation(() => {});

      await service.initialize();

      expect(service.setupPollingFallback).toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Database client not available')
      );
    });

    it('should handle initialization errors gracefully', async () => {
      db.getClient = jest.fn().mockRejectedValue(new Error('Database connection failed'));
      jest.spyOn(service, 'setupPollingFallback').mockImplementation(() => {});

      await service.initialize();

      expect(service.setupPollingFallback).toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(
        'Error initializing realtime service:',
        expect.any(Error)
      );
    });
  });

  describe('Database Notification Handling', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should handle inventory_changes notifications', () => {
      const mockNotification = {
        channel: 'inventory_changes',
        payload: JSON.stringify({
          inventory_id: 'inv-123',
          product_id: 'prod-456',
          warehouse_id: 'wh-001',
          old_quantity: 100,
          new_quantity: 90,
          quantity_available: 70,
          stock_status: 'in_stock',
          change_reason: 'sale'
        })
      };

      jest.spyOn(service, 'handleInventoryChange');
      jest.spyOn(service, 'emit');
      jest.spyOn(service, 'broadcastToSubscribers');

      service.handleDatabaseNotification(mockNotification);

      expect(service.handleInventoryChange).toHaveBeenCalledWith(
        expect.objectContaining({
          inventory_id: 'inv-123',
          product_id: 'prod-456'
        })
      );
      expect(service.emit).toHaveBeenCalledWith('inventory_change', expect.any(Object));
      expect(service.broadcastToSubscribers).toHaveBeenCalledWith(
        'inventory_change',
        expect.any(Object)
      );
    });

    it('should handle inventory_movements notifications', () => {
      const mockNotification = {
        channel: 'inventory_movements',
        payload: JSON.stringify({
          movement_id: 'mov-001',
          inventory_id: 'inv-123',
          movement_type: 'sale',
          quantity: -10
        })
      };

      jest.spyOn(service, 'handleInventoryMovement');
      jest.spyOn(service, 'emit');

      service.handleDatabaseNotification(mockNotification);

      expect(service.handleInventoryMovement).toHaveBeenCalled();
      expect(service.emit).toHaveBeenCalledWith('inventory_movement', expect.any(Object));
    });

    it('should handle stock_alerts notifications', () => {
      const mockNotification = {
        channel: 'stock_alerts',
        payload: JSON.stringify({
          inventory_id: 'inv-123',
          alert_type: 'low_stock',
          priority: 'high'
        })
      };

      jest.spyOn(service, 'handleStockAlert');
      jest.spyOn(service, 'emit');

      service.handleDatabaseNotification(mockNotification);

      expect(service.handleStockAlert).toHaveBeenCalled();
      expect(service.emit).toHaveBeenCalledWith('stock_alert', expect.any(Object));
    });

    it('should handle invalid JSON payloads gracefully', () => {
      const mockNotification = {
        channel: 'inventory_changes',
        payload: 'invalid json'
      };

      expect(() => {
        service.handleDatabaseNotification(mockNotification);
      }).not.toThrow();

      expect(console.error).toHaveBeenCalledWith(
        'Error handling database notification:',
        expect.any(Error)
      );
    });

    it('should handle unknown notification channels', () => {
      const mockNotification = {
        channel: 'unknown_channel',
        payload: JSON.stringify({ test: 'data' })
      };

      service.handleDatabaseNotification(mockNotification);

      expect(console.log).toHaveBeenCalledWith(
        'Unhandled notification channel:',
        'unknown_channel'
      );
    });
  });

  describe('WebSocket Connection Management', () => {
    it('should add WebSocket connection with subscriptions', () => {
      const connectionId = 'conn-001';
      const subscriptions = ['inventory_change', 'stock_alert'];

      service.addConnection(connectionId, mockWebSocket, subscriptions);

      expect(service.connections.has(connectionId)).toBe(true);
      const connection = service.connections.get(connectionId);
      expect(connection.ws).toBe(mockWebSocket);
      expect(connection.subscriptions).toEqual(subscriptions);
      expect(connection.connectedAt).toBeInstanceOf(Date);
    });

    it('should handle WebSocket close event', () => {
      const connectionId = 'conn-001';
      
      service.addConnection(connectionId, mockWebSocket);

      // Simulate close event
      const closeHandler = mockWebSocket.on.mock.calls.find(call => call[0] === 'close')[1];
      closeHandler();

      expect(service.connections.has(connectionId)).toBe(false);
    });

    it('should handle subscription updates via WebSocket messages', () => {
      const connectionId = 'conn-001';
      service.addConnection(connectionId, mockWebSocket);

      // Simulate message event
      const messageHandler = mockWebSocket.on.mock.calls.find(call => call[0] === 'message')[1];
      const subscribeMessage = JSON.stringify({
        action: 'subscribe',
        events: ['inventory_movement']
      });

      messageHandler(subscribeMessage);

      const connection = service.connections.get(connectionId);
      expect(connection.subscriptions).toContain('inventory_movement');
    });

    it('should handle unsubscription via WebSocket messages', () => {
      const connectionId = 'conn-001';
      const initialSubscriptions = ['inventory_change', 'stock_alert'];
      service.addConnection(connectionId, mockWebSocket, initialSubscriptions);

      const messageHandler = mockWebSocket.on.mock.calls.find(call => call[0] === 'message')[1];
      const unsubscribeMessage = JSON.stringify({
        action: 'unsubscribe',
        events: ['stock_alert']
      });

      messageHandler(unsubscribeMessage);

      const connection = service.connections.get(connectionId);
      expect(connection.subscriptions).toEqual(['inventory_change']);
      expect(connection.subscriptions).not.toContain('stock_alert');
    });

    it('should handle malformed WebSocket messages gracefully', () => {
      const connectionId = 'conn-001';
      service.addConnection(connectionId, mockWebSocket);

      const messageHandler = mockWebSocket.on.mock.calls.find(call => call[0] === 'message')[1];
      
      expect(() => {
        messageHandler('invalid json');
      }).not.toThrow();

      expect(console.error).toHaveBeenCalledWith(
        'Error handling WebSocket message:',
        expect.any(Error)
      );
    });

    it('should remove connection manually', () => {
      const connectionId = 'conn-001';
      service.addConnection(connectionId, mockWebSocket);

      service.removeConnection(connectionId);

      expect(service.connections.has(connectionId)).toBe(false);
    });
  });

  describe('Event Broadcasting', () => {
    beforeEach(() => {
      // Add multiple connections with different subscriptions
      service.addConnection('conn-001', mockWebSocket, ['inventory_change']);
      service.addConnection('conn-002', { ...mockWebSocket, send: jest.fn() }, ['stock_alert']);
      service.addConnection('conn-003', { ...mockWebSocket, send: jest.fn() }, ['inventory_change', 'stock_alert']);
    });

    it('should broadcast to subscribed connections only', () => {
      const eventData = {
        type: 'inventory_change',
        timestamp: new Date().toISOString(),
        data: mockInventoryChangeData
      };

      service.broadcastToSubscribers('inventory_change', eventData);

      // conn-001 and conn-003 should receive the event (subscribed to inventory_change)
      expect(mockWebSocket.send).toHaveBeenCalledWith(
        JSON.stringify({ event: 'inventory_change', ...eventData })
      );
      
      // conn-002 should not receive the event (not subscribed to inventory_change)
      const conn002 = Array.from(service.connections.values())[1];
      expect(conn002.ws.send).not.toHaveBeenCalled();
    });

    it('should handle WebSocket send errors gracefully', () => {
      const connectionId = 'conn-error';
      const errorWebSocket = {
        ...mockWebSocket,
        send: jest.fn().mockImplementation(() => {
          throw new Error('WebSocket send failed');
        }),
        readyState: 1
      };

      service.addConnection(connectionId, errorWebSocket, ['inventory_change']);
      jest.spyOn(service, 'removeConnection');

      const eventData = { type: 'inventory_change', data: mockInventoryChangeData };
      service.broadcastToSubscribers('inventory_change', eventData);

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Error sending to connection'),
        expect.any(Error)
      );
      expect(service.removeConnection).toHaveBeenCalledWith(connectionId);
    });

    it('should not send to closed WebSocket connections', () => {
      const closedWebSocket = { ...mockWebSocket, readyState: 3 }; // CLOSED
      service.addConnection('conn-closed', closedWebSocket, ['inventory_change']);

      const eventData = { type: 'inventory_change', data: mockInventoryChangeData };
      service.broadcastToSubscribers('inventory_change', eventData);

      expect(closedWebSocket.send).not.toHaveBeenCalled();
    });
  });

  describe('Manual Notification Triggers', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should trigger inventory change notification with database client', async () => {
      await service.notifyInventoryChange(mockInventoryChangeData);

      expect(mockDbClient.query).toHaveBeenCalledWith(
        'NOTIFY inventory_changes, $1',
        [expect.stringContaining('"inventory_id":"inv-123"')]
      );
    });

    it('should trigger inventory change notification without database client', async () => {
      service.dbNotificationClient = null;
      jest.spyOn(service, 'handleInventoryChange');

      await service.notifyInventoryChange(mockInventoryChangeData);

      expect(service.handleInventoryChange).toHaveBeenCalledWith(
        expect.objectContaining({
          inventory_id: 'inv-123',
          product_id: 'prod-456'
        })
      );
    });

    it('should trigger movement notification', async () => {
      await service.notifyInventoryMovement(mockMovementData);

      expect(mockDbClient.query).toHaveBeenCalledWith(
        'NOTIFY inventory_movements, $1',
        [expect.stringContaining('"movement_id":"mov-001"')]
      );
    });

    it('should trigger stock alert notification', async () => {
      await service.notifyStockAlert(mockStockAlertData);

      expect(mockDbClient.query).toHaveBeenCalledWith(
        'NOTIFY stock_alerts, $1',
        [expect.stringContaining('"alert_type":"low_stock"')]
      );
    });

    it('should handle notification errors gracefully', async () => {
      mockDbClient.query.mockRejectedValueOnce(new Error('Database query failed'));

      await service.notifyInventoryChange(mockInventoryChangeData);

      expect(console.error).toHaveBeenCalledWith(
        'Error sending inventory change notification:',
        expect.any(Error)
      );
    });
  });

  describe('Polling Fallback', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should setup polling fallback for low stock alerts', async () => {
      const mockLowStockItems = [
        {
          inventory_id: 'inv-123',
          product_id: 'prod-456',
          sku: 'TEST-001',
          name: 'Test Product',
          warehouse_id: 'wh-001',
          quantity_on_hand: 20,
          reorder_point: 50
        }
      ];

      db.execute.mockResolvedValue(mockLowStockItems);
      jest.spyOn(service, 'handleStockAlert');

      service.setupPollingFallback();

      // Fast-forward 30 seconds to trigger polling
      jest.advanceTimersByTime(30000);

      await new Promise(resolve => setImmediate(resolve));

      expect(db.execute).toHaveBeenCalledWith(expect.objectContaining({
        sql: expect.stringContaining('SELECT i.id as inventory_id')
      }));
      expect(service.handleStockAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          inventory_id: 'inv-123',
          alert_type: 'low_stock'
        })
      );
    });

    it('should handle polling errors gracefully', async () => {
      db.execute.mockRejectedValue(new Error('Database query failed'));

      service.setupPollingFallback();
      jest.advanceTimersByTime(30000);

      await new Promise(resolve => setImmediate(resolve));

      expect(console.error).toHaveBeenCalledWith(
        'Error in polling fallback:',
        expect.any(Error)
      );
    });
  });

  describe('Optimistic Locking', () => {
    it('should successfully acquire optimistic lock', async () => {
      const mockResult = [{ id: 'inv-123', updated_at: new Date() }];
      db.execute.mockResolvedValue(mockResult);

      const result = await service.tryOptimisticLock('inv-123', new Date('2024-01-15T10:00:00Z'));

      expect(result).toEqual(mockResult[0]);
      expect(db.execute).toHaveBeenCalledWith(expect.objectContaining({
        sql: expect.stringContaining('UPDATE inventory')
      }));
    });

    it('should fail to acquire lock when version mismatch', async () => {
      db.execute.mockResolvedValue([]);

      const result = await service.tryOptimisticLock('inv-123', new Date('2024-01-01T00:00:00Z'));

      expect(result).toBeNull();
    });

    it('should handle lock errors gracefully', async () => {
      db.execute.mockRejectedValue(new Error('Database error'));

      const result = await service.tryOptimisticLock('inv-123', new Date());

      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalledWith(
        'Error in optimistic lock:',
        expect.any(Error)
      );
    });
  });

  describe('Connection Statistics', () => {
    it('should return accurate connection statistics', () => {
      service.addConnection('conn-001', mockWebSocket, ['inventory_change']);
      service.addConnection('conn-002', { ...mockWebSocket, readyState: 3 }, ['stock_alert']);

      const stats = service.getConnectionStats();

      expect(stats.totalConnections).toBe(2);
      expect(stats.connectionsDetail).toHaveLength(2);
      expect(stats.connectionsDetail[0]).toHaveProperty('id');
      expect(stats.connectionsDetail[0]).toHaveProperty('subscriptions');
      expect(stats.connectionsDetail[0]).toHaveProperty('connectedAt');
      expect(stats.connectionsDetail[0]).toHaveProperty('isActive');
      expect(stats.connectionsDetail[0].isActive).toBe(true);
      expect(stats.connectionsDetail[1].isActive).toBe(false);
    });
  });

  describe('Cleanup', () => {
    beforeEach(async () => {
      await service.initialize();
      service.addConnection('conn-001', mockWebSocket);
      service.addConnection('conn-002', { ...mockWebSocket, close: jest.fn() });
    });

    it('should cleanup all connections and resources', async () => {
      await service.cleanup();

      expect(mockWebSocket.close).toHaveBeenCalled();
      expect(service.connections.size).toBe(0);
      expect(mockDbClient.end).toHaveBeenCalled();
      expect(service.dbNotificationClient).toBeNull();
      expect(service.isListening).toBe(false);
    });

    it('should handle cleanup errors gracefully', async () => {
      mockDbClient.end.mockRejectedValueOnce(new Error('Cleanup failed'));

      await service.cleanup();

      expect(console.error).toHaveBeenCalledWith(
        'Error during cleanup:',
        expect.any(Error)
      );
    });
  });

  describe('Event Emitter Functionality', () => {
    it('should emit events that can be listened to', (done) => {
      service.on('inventory_change', (eventData) => {
        expect(eventData.type).toBe('inventory_change');
        expect(eventData.data.inventoryId).toBe('inv-123');
        done();
      });

      service.handleInventoryChange({
        inventory_id: 'inv-123',
        product_id: 'prod-456',
        warehouse_id: 'wh-001',
        old_quantity: 100,
        new_quantity: 90
      });
    });

    it('should emit movement events', (done) => {
      service.on('inventory_movement', (eventData) => {
        expect(eventData.type).toBe('inventory_movement');
        expect(eventData.data.movementId).toBe('mov-001');
        done();
      });

      service.handleInventoryMovement({
        movement_id: 'mov-001',
        inventory_id: 'inv-123',
        movement_type: 'sale'
      });
    });

    it('should emit stock alert events with priority', (done) => {
      service.on('stock_alert', (eventData) => {
        expect(eventData.type).toBe('stock_alert');
        expect(eventData.priority).toBe('critical');
        expect(eventData.data.alertType).toBe('out_of_stock');
        done();
      });

      service.handleStockAlert({
        inventory_id: 'inv-123',
        alert_type: 'out_of_stock',
        priority: 'critical'
      });
    });
  });

  describe('Singleton Instance', () => {
    it('should export a singleton instance', () => {
      expect(realtimeService).toBeInstanceOf(RealtimeInventoryService);
      expect(realtimeService).toBe(realtimeService); // Same reference
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle complete inventory update workflow', async () => {
      await service.initialize();
      
      // Add WebSocket connections
      const conn1 = { ...mockWebSocket, send: jest.fn() };
      const conn2 = { ...mockWebSocket, send: jest.fn() };
      
      service.addConnection('dashboard', conn1, ['inventory_change', 'stock_alert']);
      service.addConnection('warehouse', conn2, ['inventory_movement']);

      // Trigger inventory change
      await service.notifyInventoryChange(mockInventoryChangeData);

      // Should notify database
      expect(mockDbClient.query).toHaveBeenCalledWith(
        'NOTIFY inventory_changes, $1',
        expect.any(Array)
      );

      // Simulate database notification callback
      const notificationHandler = mockDbClient.on.mock.calls.find(call => call[0] === 'notification')[1];
      notificationHandler({
        channel: 'inventory_changes',
        payload: JSON.stringify({
          inventory_id: 'inv-123',
          stock_status: 'low_stock'
        })
      });

      // Dashboard should receive inventory change
      expect(conn1.send).toHaveBeenCalledWith(
        expect.stringContaining('inventory_change')
      );

      // Warehouse should not receive inventory change (not subscribed)
      expect(conn2.send).not.toHaveBeenCalled();
    });

    it('should cascade stock alerts when inventory goes critical', async () => {
      await service.initialize();
      
      const alertConnection = { ...mockWebSocket, send: jest.fn() };
      service.addConnection('alerts', alertConnection, ['stock_alert']);

      const criticalAlertData = {
        ...mockStockAlertData,
        currentQuantity: 0,
        alertType: 'out_of_stock',
        priority: 'critical'
      };

      await service.notifyStockAlert(criticalAlertData);

      // Should send database notification
      expect(mockDbClient.query).toHaveBeenCalledWith(
        'NOTIFY stock_alerts, $1',
        [expect.stringContaining('"priority":"critical"')]
      );
    });
  });
});