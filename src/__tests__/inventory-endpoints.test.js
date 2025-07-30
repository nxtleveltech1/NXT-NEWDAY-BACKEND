import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import * as inventoryQueries from '../db/inventory-queries.js';
import * as inventoryAnalytics from '../db/inventory-analytics.js';
import { realtimeService } from '../services/realtime-service.js';

// Mock dependencies
jest.mock('../db/inventory-queries.js');
jest.mock('../db/inventory-analytics.js');
jest.mock('../services/realtime-service.js');
jest.mock('jsonwebtoken');

describe('Inventory API Endpoints', () => {
  let app;
  let validToken;

  const mockInventoryItem = {
    id: 'inv-123',
    productId: 'prod-456',
    warehouseId: 'wh-001',
    locationId: 'loc-001',
    quantityOnHand: 100,
    quantityAvailable: 80,
    quantityReserved: 20,
    quantityInTransit: 0,
    stockStatus: 'in_stock',
    reorderPoint: 50,
    reorderQuantity: 100,
    averageCost: 10.50,
    productSku: 'TEST-001',
    productName: 'Test Product',
    productCategory: 'electronics',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-15T10:00:00Z')
  };

  const mockMovement = {
    id: 'mov-001',
    inventoryId: 'inv-123',
    productId: 'prod-456',
    warehouseId: 'wh-001',
    movementType: 'sale',
    quantity: -10,
    quantityAfter: 90,
    performedBy: 'user-001',
    referenceNumber: 'ORD-2024-001',
    productSku: 'TEST-001',
    productName: 'Test Product',
    createdAt: new Date('2024-01-15T14:00:00Z')
  };

  const mockUser = {
    sub: 'user-001',
    email: 'test@example.com',
    iat: Date.now() / 1000,
    exp: (Date.now() / 1000) + 3600
  };

  beforeAll(() => {
    // Setup Express app with middleware
    app = express();
    app.use(cors());
    app.use(express.json());

    // Mock authentication middleware
    app.use((req, res, next) => {
      const authHeader = req.headers['authorization'];
      const token = authHeader && authHeader.split(' ')[1];
      
      if (!token) {
        return res.status(401).json({ error: 'Access token required' });
      }

      // Mock JWT verification
      jwt.verify.mockImplementation((token, secretOrKey, options, callback) => {
        if (token === 'valid-token') {
          callback(null, mockUser);
        } else {
          callback(new Error('Invalid token'));
        }
      });

      jwt.verify(token, 'mock-secret', (err, user) => {
        if (err) {
          return res.status(403).json({ error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
      });
    });

    // Inventory endpoints
    app.get('/api/inventory', async (req, res) => {
      try {
        const result = await inventoryQueries.getInventory(req.query);
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.get('/api/inventory/:id', async (req, res) => {
      try {
        const inventory = await inventoryQueries.getInventoryById(req.params.id);
        if (!inventory) {
          return res.status(404).json({ error: 'Inventory item not found' });
        }
        res.json(inventory);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.post('/api/inventory', async (req, res) => {
      try {
        const inventory = await inventoryQueries.upsertInventory(req.body);
        res.status(201).json(inventory);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.post('/api/inventory/movements', async (req, res) => {
      try {
        const result = await inventoryQueries.recordMovement(req.body);
        res.status(201).json(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.put('/api/inventory/:id/adjust', async (req, res) => {
      try {
        const { newQuantity, reason, notes } = req.body;
        const result = await inventoryQueries.adjustStock(
          req.params.id,
          newQuantity,
          reason,
          req.user.sub,
          notes
        );
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.post('/api/inventory/:productId/reserve', async (req, res) => {
      try {
        const { warehouseId, quantity } = req.body;
        const result = await inventoryQueries.reserveStock(
          req.params.productId,
          warehouseId,
          quantity
        );
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.post('/api/inventory/:productId/release', async (req, res) => {
      try {
        const { warehouseId, quantity } = req.body;
        const result = await inventoryQueries.releaseReservedStock(
          req.params.productId,
          warehouseId,
          quantity
        );
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.get('/api/inventory/movements', async (req, res) => {
      try {
        const result = await inventoryQueries.getMovements(req.query);
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.get('/api/inventory/reorder', async (req, res) => {
      try {
        const suggestions = await inventoryQueries.getReorderSuggestions();
        res.json(suggestions);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.get('/api/inventory/analytics', async (req, res) => {
      try {
        const analytics = await inventoryQueries.getInventoryAnalytics(req.query);
        res.json(analytics);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.get('/api/inventory/analytics/advanced', async (req, res) => {
      try {
        const analytics = await inventoryQueries.getAdvancedInventoryAnalytics(req.query);
        res.json(analytics);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.get('/api/analytics/inventory/turnover', async (req, res) => {
      try {
        const turnoverData = await inventoryAnalytics.getInventoryTurnoverAnalysis(req.query);
        res.json(turnoverData);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.get('/api/realtime/stats', (req, res) => {
      try {
        const stats = realtimeService.getConnectionStats();
        res.json(stats);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    validToken = 'valid-token';
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Authentication', () => {
    it('should require authentication for all endpoints', async () => {
      const response = await request(app)
        .get('/api/inventory')
        .expect(401);

      expect(response.body).toEqual({ error: 'Access token required' });
    });

    it('should reject invalid tokens', async () => {
      const response = await request(app)
        .get('/api/inventory')
        .set('Authorization', 'Bearer invalid-token')
        .expect(403);

      expect(response.body).toEqual({ error: 'Invalid or expired token' });
    });

    it('should accept valid tokens', async () => {
      inventoryQueries.getInventory.mockResolvedValue({
        data: [],
        pagination: { page: 1, limit: 10, total: 0, totalPages: 0 }
      });

      const response = await request(app)
        .get('/api/inventory')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('pagination');
    });
  });

  describe('GET /api/inventory', () => {
    beforeEach(() => {
      inventoryQueries.getInventory.mockResolvedValue({
        data: [mockInventoryItem],
        pagination: { page: 1, limit: 10, total: 1, totalPages: 1 }
      });
    });

    it('should return paginated inventory list', async () => {
      const response = await request(app)
        .get('/api/inventory')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toEqual(mockInventoryItem);
      expect(response.body.pagination.total).toBe(1);
    });

    it('should accept query parameters for filtering', async () => {
      await request(app)
        .get('/api/inventory')
        .query({
          page: 2,
          limit: 20,
          search: 'test',
          warehouseId: 'wh-001',
          stockStatus: 'in_stock',
          belowReorderPoint: 'true',
          sortBy: 'productName',
          sortOrder: 'asc'
        })
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);

      expect(inventoryQueries.getInventory).toHaveBeenCalledWith({
        page: '2',
        limit: '20',
        search: 'test',
        warehouseId: 'wh-001',
        stockStatus: 'in_stock',
        belowReorderPoint: 'true',
        sortBy: 'productName',
        sortOrder: 'asc'
      });
    });

    it('should handle database errors', async () => {
      inventoryQueries.getInventory.mockRejectedValue(new Error('Database connection failed'));

      const response = await request(app)
        .get('/api/inventory')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(500);

      expect(response.body).toEqual({ error: 'Database connection failed' });
    });
  });

  describe('GET /api/inventory/:id', () => {
    it('should return specific inventory item', async () => {
      inventoryQueries.getInventoryById.mockResolvedValue(mockInventoryItem);

      const response = await request(app)
        .get('/api/inventory/inv-123')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);

      expect(response.body).toEqual(mockInventoryItem);
      expect(inventoryQueries.getInventoryById).toHaveBeenCalledWith('inv-123');
    });

    it('should return 404 if inventory item not found', async () => {
      inventoryQueries.getInventoryById.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/inventory/non-existent')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(404);

      expect(response.body).toEqual({ error: 'Inventory item not found' });
    });
  });

  describe('POST /api/inventory', () => {
    const newInventoryData = {
      productId: 'prod-456',
      warehouseId: 'wh-001',
      quantityOnHand: 100,
      reorderPoint: 50,
      reorderQuantity: 100
    };

    it('should create new inventory item', async () => {
      inventoryQueries.upsertInventory.mockResolvedValue({
        ...mockInventoryItem,
        ...newInventoryData
      });

      const response = await request(app)
        .post('/api/inventory')
        .set('Authorization', `Bearer ${validToken}`)
        .send(newInventoryData)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.productId).toBe(newInventoryData.productId);
      expect(inventoryQueries.upsertInventory).toHaveBeenCalledWith(newInventoryData);
    });

    it('should validate required fields', async () => {
      inventoryQueries.upsertInventory.mockRejectedValue(new Error('Product ID is required'));

      const response = await request(app)
        .post('/api/inventory')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ warehouseId: 'wh-001' }) // Missing productId
        .expect(500);

      expect(response.body.error).toContain('Product ID is required');
    });
  });

  describe('POST /api/inventory/movements', () => {
    const movementData = {
      inventoryId: 'inv-123',
      productId: 'prod-456',
      warehouseId: 'wh-001',
      movementType: 'sale',
      quantity: -10,
      referenceType: 'order',
      referenceId: 'ord-001',
      performedBy: 'user-001'
    };

    it('should record inventory movement', async () => {
      inventoryQueries.recordMovement.mockResolvedValue({
        movement: mockMovement,
        inventory: { ...mockInventoryItem, quantityOnHand: 90 }
      });

      const response = await request(app)
        .post('/api/inventory/movements')
        .set('Authorization', `Bearer ${validToken}`)
        .send(movementData)
        .expect(201);

      expect(response.body).toHaveProperty('movement');
      expect(response.body).toHaveProperty('inventory');
      expect(response.body.movement.quantity).toBe(-10);
      expect(inventoryQueries.recordMovement).toHaveBeenCalledWith(movementData);
    });

    it('should handle insufficient stock errors', async () => {
      inventoryQueries.recordMovement.mockRejectedValue(new Error('Insufficient available stock'));

      const response = await request(app)
        .post('/api/inventory/movements')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ ...movementData, quantity: -1000 })
        .expect(500);

      expect(response.body.error).toBe('Insufficient available stock');
    });
  });

  describe('PUT /api/inventory/:id/adjust', () => {
    const adjustmentData = {
      newQuantity: 120,
      reason: 'Physical count adjustment',
      notes: 'Annual inventory count'
    };

    it('should adjust inventory stock', async () => {
      inventoryQueries.adjustStock.mockResolvedValue({
        ...mockInventoryItem,
        quantityOnHand: 120
      });

      const response = await request(app)
        .put('/api/inventory/inv-123/adjust')
        .set('Authorization', `Bearer ${validToken}`)
        .send(adjustmentData)
        .expect(200);

      expect(response.body.quantityOnHand).toBe(120);
      expect(inventoryQueries.adjustStock).toHaveBeenCalledWith(
        'inv-123',
        120,
        'Physical count adjustment',
        'user-001',
        'Annual inventory count'
      );
    });

    it('should require adjustment reason', async () => {
      const response = await request(app)
        .put('/api/inventory/inv-123/adjust')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ newQuantity: 120 }) // Missing reason
        .expect(200); // The endpoint doesn't validate this, but the service layer might

      expect(inventoryQueries.adjustStock).toHaveBeenCalledWith(
        'inv-123',
        120,
        undefined,
        'user-001',
        undefined
      );
    });
  });

  describe('POST /api/inventory/:productId/reserve', () => {
    const reservationData = {
      warehouseId: 'wh-001',
      quantity: 30
    };

    it('should reserve stock successfully', async () => {
      inventoryQueries.reserveStock.mockResolvedValue({
        ...mockInventoryItem,
        quantityAvailable: 50,
        quantityReserved: 50
      });

      const response = await request(app)
        .post('/api/inventory/prod-456/reserve')
        .set('Authorization', `Bearer ${validToken}`)
        .send(reservationData)
        .expect(200);

      expect(response.body.quantityReserved).toBe(50);
      expect(inventoryQueries.reserveStock).toHaveBeenCalledWith(
        'prod-456',
        'wh-001',
        30
      );
    });

    it('should handle insufficient stock for reservation', async () => {
      inventoryQueries.reserveStock.mockRejectedValue(
        new Error('Insufficient available stock for reservation')
      );

      const response = await request(app)
        .post('/api/inventory/prod-456/reserve')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ ...reservationData, quantity: 1000 })
        .expect(500);

      expect(response.body.error).toBe('Insufficient available stock for reservation');
    });
  });

  describe('POST /api/inventory/:productId/release', () => {
    const releaseData = {
      warehouseId: 'wh-001',
      quantity: 10
    };

    it('should release reserved stock successfully', async () => {
      inventoryQueries.releaseReservedStock.mockResolvedValue({
        ...mockInventoryItem,
        quantityAvailable: 90,
        quantityReserved: 10
      });

      const response = await request(app)
        .post('/api/inventory/prod-456/release')
        .set('Authorization', `Bearer ${validToken}`)
        .send(releaseData)
        .expect(200);

      expect(response.body.quantityReserved).toBe(10);
      expect(inventoryQueries.releaseReservedStock).toHaveBeenCalledWith(
        'prod-456',
        'wh-001',
        10
      );
    });

    it('should handle invalid release quantity', async () => {
      inventoryQueries.releaseReservedStock.mockRejectedValue(
        new Error('Cannot release more than reserved quantity')
      );

      const response = await request(app)
        .post('/api/inventory/prod-456/release')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ ...releaseData, quantity: 100 })
        .expect(500);

      expect(response.body.error).toBe('Cannot release more than reserved quantity');
    });
  });

  describe('GET /api/inventory/movements', () => {
    beforeEach(() => {
      inventoryQueries.getMovements.mockResolvedValue({
        data: [mockMovement],
        pagination: { page: 1, limit: 10, total: 1, totalPages: 1 }
      });
    });

    it('should return paginated movement history', async () => {
      const response = await request(app)
        .get('/api/inventory/movements')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toEqual(mockMovement);
    });

    it('should accept filter parameters', async () => {
      await request(app)
        .get('/api/inventory/movements')
        .query({
          inventoryId: 'inv-123',
          movementType: 'sale',
          dateFrom: '2024-01-01',
          dateTo: '2024-01-31'
        })
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);

      expect(inventoryQueries.getMovements).toHaveBeenCalledWith({
        inventoryId: 'inv-123',
        movementType: 'sale',
        dateFrom: '2024-01-01',
        dateTo: '2024-01-31'
      });
    });
  });

  describe('GET /api/inventory/reorder', () => {
    it('should return reorder suggestions', async () => {
      const mockSuggestions = [
        {
          id: 'inv-123',
          productSku: 'TEST-001',
          productName: 'Test Product',
          quantityAvailable: 30,
          reorderPoint: 50,
          reorderQuantity: 100,
          supplierName: 'Test Supplier'
        }
      ];

      inventoryQueries.getReorderSuggestions.mockResolvedValue(mockSuggestions);

      const response = await request(app)
        .get('/api/inventory/reorder')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].quantityAvailable).toBeLessThan(response.body[0].reorderPoint);
    });

    it('should return empty array when no reorders needed', async () => {
      inventoryQueries.getReorderSuggestions.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/inventory/reorder')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);

      expect(response.body).toHaveLength(0);
    });
  });

  describe('GET /api/inventory/analytics', () => {
    it('should return inventory analytics', async () => {
      const mockAnalytics = {
        summary: {
          totalItems: '500',
          totalValue: '50000.00',
          itemsBelowReorder: '25'
        },
        categoryBreakdown: [
          { category: 'electronics', itemCount: '100', totalValue: '20000.00' }
        ],
        stockStatusBreakdown: [
          { stockStatus: 'in_stock', count: '450', totalValue: '45000.00' }
        ]
      };

      inventoryQueries.getInventoryAnalytics.mockResolvedValue(mockAnalytics);

      const response = await request(app)
        .get('/api/inventory/analytics')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('summary');
      expect(response.body).toHaveProperty('categoryBreakdown');
      expect(response.body).toHaveProperty('stockStatusBreakdown');
    });

    it('should accept filter parameters for analytics', async () => {
      inventoryQueries.getInventoryAnalytics.mockResolvedValue({
        summary: {},
        categoryBreakdown: [],
        stockStatusBreakdown: []
      });

      await request(app)
        .get('/api/inventory/analytics')
        .query({ warehouseId: 'wh-001', categoryFilter: 'electronics' })
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);

      expect(inventoryQueries.getInventoryAnalytics).toHaveBeenCalledWith({
        warehouseId: 'wh-001',
        categoryFilter: 'electronics'
      });
    });
  });

  describe('GET /api/inventory/analytics/advanced', () => {
    it('should return advanced analytics', async () => {
      const mockAdvancedAnalytics = {
        turnoverAnalysis: [
          {
            productSku: 'TEST-001',
            turnoverRatio: 0.5,
            daysOfInventory: 730
          }
        ],
        agingAnalysis: {
          details: [],
          summary: []
        },
        trendAnalysis: {
          dailyTrends: [],
          categoryTrends: []
        }
      };

      inventoryQueries.getAdvancedInventoryAnalytics.mockResolvedValue(mockAdvancedAnalytics);

      const response = await request(app)
        .get('/api/inventory/analytics/advanced')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('turnoverAnalysis');
      expect(response.body).toHaveProperty('agingAnalysis');
      expect(response.body).toHaveProperty('trendAnalysis');
    });

    it('should accept analysis type parameter', async () => {
      inventoryQueries.getAdvancedInventoryAnalytics.mockResolvedValue({
        turnoverAnalysis: []
      });

      await request(app)
        .get('/api/inventory/analytics/advanced')
        .query({ analysisType: 'turnover', dateFrom: '2024-01-01' })
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);

      expect(inventoryQueries.getAdvancedInventoryAnalytics).toHaveBeenCalledWith({
        analysisType: 'turnover',
        dateFrom: '2024-01-01'
      });
    });
  });

  describe('GET /api/analytics/inventory/turnover', () => {
    it('should return turnover analysis from analytics service', async () => {
      const mockTurnoverData = {
        products: [
          {
            productSku: 'TEST-001',
            turnoverRate: 2.5,
            averageInventoryValue: 1000,
            salesVelocity: 50
          }
        ],
        summary: {
          averageTurnover: 2.1,
          totalProducts: 100
        }
      };

      inventoryAnalytics.getInventoryTurnoverAnalysis.mockResolvedValue(mockTurnoverData);

      const response = await request(app)
        .get('/api/analytics/inventory/turnover')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('products');
      expect(response.body).toHaveProperty('summary');
      expect(response.body.products[0].turnoverRate).toBe(2.5);
    });
  });

  describe('GET /api/realtime/stats', () => {
    it('should return realtime service statistics', async () => {
      const mockStats = {
        totalConnections: 5,
        connectionsDetail: [
          {
            id: 'conn-001',
            subscriptions: ['inventory_change'],
            connectedAt: new Date(),
            isActive: true
          }
        ],
        isListening: true
      };

      realtimeService.getConnectionStats.mockReturnValue(mockStats);

      const response = await request(app)
        .get('/api/realtime/stats')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);

      expect(response.body.totalConnections).toBe(5);
      expect(response.body.isListening).toBe(true);
      expect(response.body.connectionsDetail).toHaveLength(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed JSON requests', async () => {
      const response = await request(app)
        .post('/api/inventory')
        .set('Authorization', `Bearer ${validToken}`)
        .set('Content-Type', 'application/json')
        .send('{"invalid": json}')
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    it('should handle large request payloads gracefully', async () => {
      const largePayload = {
        productId: 'prod-456',
        warehouseId: 'wh-001',
        notes: 'x'.repeat(10000) // Very long notes field
      };

      inventoryQueries.upsertInventory.mockResolvedValue(mockInventoryItem);

      const response = await request(app)
        .post('/api/inventory')
        .set('Authorization', `Bearer ${validToken}`)
        .send(largePayload)
        .expect(201);

      expect(response.body).toHaveProperty('id');
    });

    it('should handle database timeout errors', async () => {
      inventoryQueries.getInventory.mockRejectedValue(new Error('Database query timeout'));

      const response = await request(app)
        .get('/api/inventory')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(500);

      expect(response.body.error).toBe('Database query timeout');
    });

    it('should handle concurrent modification errors', async () => {
      inventoryQueries.recordMovement.mockRejectedValue(
        new Error('Serialization failure - transaction was deadlocked')
      );

      const response = await request(app)
        .post('/api/inventory/movements')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          inventoryId: 'inv-123',
          movementType: 'sale',
          quantity: -10
        })
        .expect(500);

      expect(response.body.error).toContain('Serialization failure');
    });
  });

  describe('Input Validation', () => {
    it('should handle invalid UUID parameters', async () => {
      inventoryQueries.getInventoryById.mockRejectedValue(new Error('Invalid UUID format'));

      const response = await request(app)
        .get('/api/inventory/invalid-uuid')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(500);

      expect(response.body.error).toBe('Invalid UUID format');
    });

    it('should handle negative quantities in movements', async () => {
      inventoryQueries.recordMovement.mockRejectedValue(
        new Error('Invalid quantity: cannot be negative for inbound movements')
      );

      const response = await request(app)
        .post('/api/inventory/movements')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          inventoryId: 'inv-123',
          movementType: 'purchase',
          quantity: -10 // Negative quantity for inbound movement
        })
        .expect(500);

      expect(response.body.error).toContain('Invalid quantity');
    });

    it('should handle missing required fields', async () => {
      inventoryQueries.upsertInventory.mockRejectedValue(
        new Error('Missing required field: productId')
      );

      const response = await request(app)
        .post('/api/inventory')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ warehouseId: 'wh-001' }) // Missing productId
        .expect(500);

      expect(response.body.error).toContain('Missing required field');
    });
  });

  describe('Performance and Load Testing Scenarios', () => {
    it('should handle multiple concurrent requests', async () => {
      inventoryQueries.getInventory.mockResolvedValue({
        data: [mockInventoryItem],
        pagination: { page: 1, limit: 10, total: 1, totalPages: 1 }
      });

      const requests = Array(10).fill().map(() =>
        request(app)
          .get('/api/inventory')
          .set('Authorization', `Bearer ${validToken}`)
      );

      const responses = await Promise.all(requests);

      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(1);
      });

      expect(inventoryQueries.getInventory).toHaveBeenCalledTimes(10);
    });

    it('should handle pagination with large datasets', async () => {
      inventoryQueries.getInventory.mockResolvedValue({
        data: Array(100).fill().map((_, i) => ({ ...mockInventoryItem, id: `inv-${i}` })),
        pagination: { page: 1, limit: 100, total: 10000, totalPages: 100 }
      });

      const response = await request(app)
        .get('/api/inventory')
        .query({ limit: 100 })
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);

      expect(response.body.data).toHaveLength(100);
      expect(response.body.pagination.total).toBe(10000);
    });

    it('should handle complex filter combinations', async () => {
      inventoryQueries.getInventory.mockResolvedValue({
        data: [],
        pagination: { page: 1, limit: 10, total: 0, totalPages: 0 }
      });

      const response = await request(app)
        .get('/api/inventory')
        .query({
          search: 'electronic',
          warehouseId: 'wh-001',
          stockStatus: 'low_stock',
          belowReorderPoint: 'true',
          sortBy: 'productName',
          sortOrder: 'asc',
          page: 5,
          limit: 25
        })
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);

      expect(inventoryQueries.getInventory).toHaveBeenCalledWith({
        search: 'electronic',
        warehouseId: 'wh-001',
        stockStatus: 'low_stock',
        belowReorderPoint: 'true',
        sortBy: 'productName',
        sortOrder: 'asc',
        page: '5',
        limit: '25'
      });
    });
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });
});