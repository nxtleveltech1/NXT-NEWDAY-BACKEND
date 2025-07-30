import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import multer from 'multer';
import supplierRoutes from '../supplier.routes.js';

// Mock dependencies
jest.mock('../../db/supplier-queries.js');
jest.mock('../../db/price-list-queries.js');
jest.mock('../../utils/file-parsers/index.js');
jest.mock('../../utils/upload-queue.js');

// Create test app
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/suppliers', supplierRoutes);
  return app;
}

describe('Supplier Routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createTestApp();
  });

  describe('GET /api/suppliers', () => {
    test('should get suppliers with pagination', async () => {
      const mockSuppliers = {
        suppliers: [
          { id: '1', supplierCode: 'SUP001', companyName: 'Supplier 1' },
          { id: '2', supplierCode: 'SUP002', companyName: 'Supplier 2' }
        ],
        totalCount: 2,
        page: 1,
        totalPages: 1
      };

      const { getSuppliers } = await import('../../db/supplier-queries.js');
      getSuppliers.mockResolvedValue(mockSuppliers);

      const response = await request(app)
        .get('/api/suppliers?page=1&limit=10')
        .expect(200);

      expect(response.body).toEqual(mockSuppliers);
      expect(getSuppliers).toHaveBeenCalledWith({
        page: 1,
        limit: 10,
        search: '',
        isActive: null,
        sortBy: 'createdAt',
        sortOrder: 'desc'
      });
    });

    test('should search suppliers', async () => {
      const { getSuppliers } = await import('../../db/supplier-queries.js');
      getSuppliers.mockResolvedValue({ suppliers: [], totalCount: 0 });

      await request(app)
        .get('/api/suppliers?search=test')
        .expect(200);

      expect(getSuppliers).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'test' })
      );
    });

    test('should filter by active status', async () => {
      const { getSuppliers } = await import('../../db/supplier-queries.js');
      getSuppliers.mockResolvedValue({ suppliers: [], totalCount: 0 });

      await request(app)
        .get('/api/suppliers?isActive=true')
        .expect(200);

      expect(getSuppliers).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: true })
      );
    });

    test('should handle database errors', async () => {
      const { getSuppliers } = await import('../../db/supplier-queries.js');
      getSuppliers.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/suppliers')
        .expect(500);

      expect(response.body.error).toBe('Database error');
    });
  });

  describe('GET /api/suppliers/:id', () => {
    test('should get supplier by ID', async () => {
      const mockSupplier = {
        id: 'supplier-123',
        supplierCode: 'SUP001',
        companyName: 'Test Supplier'
      };

      const { getSupplierById } = await import('../../db/supplier-queries.js');
      getSupplierById.mockResolvedValue(mockSupplier);

      const response = await request(app)
        .get('/api/suppliers/supplier-123')
        .expect(200);

      expect(response.body).toEqual(mockSupplier);
    });

    test('should return 404 for non-existent supplier', async () => {
      const { getSupplierById } = await import('../../db/supplier-queries.js');
      getSupplierById.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/suppliers/non-existent')
        .expect(404);

      expect(response.body.error).toBe('Supplier not found');
    });

    test('should validate UUID format', async () => {
      const response = await request(app)
        .get('/api/suppliers/invalid-id')
        .expect(400);

      expect(response.body.error).toBe('Validation failed');
    });
  });

  describe('POST /api/suppliers', () => {
    test('should create new supplier', async () => {
      const newSupplier = {
        supplierCode: 'SUP003',
        companyName: 'New Supplier',
        email: 'new@supplier.com',
        contactPerson: 'John Doe',
        phone: '+1234567890',
        address: '123 Main St',
        paymentTerms: 30
      };

      const mockCreated = { id: 'new-id', ...newSupplier };

      const { createSupplier, getSupplierByCode, supplierExistsByEmail } = 
        await import('../../db/supplier-queries.js');
      
      getSupplierByCode.mockResolvedValue(null);
      supplierExistsByEmail.mockResolvedValue(false);
      createSupplier.mockResolvedValue(mockCreated);

      const response = await request(app)
        .post('/api/suppliers')
        .send(newSupplier)
        .expect(201);

      expect(response.body).toEqual(mockCreated);
      expect(createSupplier).toHaveBeenCalledWith(
        expect.objectContaining(newSupplier)
      );
    });

    test('should validate required fields', async () => {
      const response = await request(app)
        .post('/api/suppliers')
        .send({
          companyName: 'A' // Too short
        })
        .expect(400);

      expect(response.body.error).toBe('Validation failed');
      expect(response.body.details).toContainEqual(
        expect.objectContaining({
          path: 'companyName',
          msg: 'Company name must be 2-255 characters'
        })
      );
    });

    test('should check for duplicate email', async () => {
      const { supplierExistsByEmail } = await import('../../db/supplier-queries.js');
      supplierExistsByEmail.mockResolvedValue(true);

      const response = await request(app)
        .post('/api/suppliers')
        .send({
          companyName: 'Test Supplier',
          email: 'existing@supplier.com',
          supplierCode: 'SUP001'
        })
        .expect(409);

      expect(response.body.error).toBe('Email already exists');
    });

    test('should check for duplicate supplier code', async () => {
      const { getSupplierByCode, supplierExistsByEmail } = 
        await import('../../db/supplier-queries.js');
      
      supplierExistsByEmail.mockResolvedValue(false);
      getSupplierByCode.mockResolvedValue({ id: 'existing' });

      const response = await request(app)
        .post('/api/suppliers')
        .send({
          companyName: 'Test Supplier',
          email: 'new@supplier.com',
          supplierCode: 'SUP001'
        })
        .expect(409);

      expect(response.body.error).toBe('Supplier code already exists');
    });
  });

  describe('PUT /api/suppliers/:id', () => {
    test('should update supplier', async () => {
      const updates = {
        companyName: 'Updated Supplier',
        phone: '+0987654321'
      };

      const mockUpdated = {
        id: 'supplier-123',
        ...updates,
        supplierCode: 'SUP001'
      };

      const { getSupplierById, updateSupplier } = 
        await import('../../db/supplier-queries.js');
      
      getSupplierById.mockResolvedValue({ id: 'supplier-123' });
      updateSupplier.mockResolvedValue(mockUpdated);

      const response = await request(app)
        .put('/api/suppliers/supplier-123')
        .send(updates)
        .expect(200);

      expect(response.body).toEqual(mockUpdated);
      expect(updateSupplier).toHaveBeenCalledWith('supplier-123', updates);
    });

    test('should validate email updates', async () => {
      const { getSupplierById, supplierExistsByEmail } = 
        await import('../../db/supplier-queries.js');
      
      getSupplierById.mockResolvedValue({ 
        id: 'supplier-123',
        email: 'old@supplier.com'
      });
      supplierExistsByEmail.mockResolvedValue(true);

      const response = await request(app)
        .put('/api/suppliers/supplier-123')
        .send({ email: 'existing@supplier.com' })
        .expect(409);

      expect(response.body.error).toBe('Email already exists');
    });

    test('should return 404 for non-existent supplier', async () => {
      const { getSupplierById } = await import('../../db/supplier-queries.js');
      getSupplierById.mockResolvedValue(null);

      const response = await request(app)
        .put('/api/suppliers/non-existent')
        .send({ companyName: 'Updated' })
        .expect(404);

      expect(response.body.error).toBe('Supplier not found');
    });
  });

  describe('DELETE /api/suppliers/:id', () => {
    test('should deactivate supplier', async () => {
      const mockDeactivated = {
        id: 'supplier-123',
        isActive: false
      };

      const { getSupplierById, getSupplierWithPriceLists, deactivateSupplier } = 
        await import('../../db/supplier-queries.js');
      
      getSupplierById.mockResolvedValue({ id: 'supplier-123', isActive: true });
      getSupplierWithPriceLists.mockResolvedValue({ priceLists: [] });
      deactivateSupplier.mockResolvedValue(mockDeactivated);

      const response = await request(app)
        .delete('/api/suppliers/supplier-123')
        .send({ reason: 'No longer needed' })
        .expect(200);

      expect(response.body).toEqual(mockDeactivated);
    });

    test('should prevent deactivation with active price lists', async () => {
      const { getSupplierById, getSupplierWithPriceLists } = 
        await import('../../db/supplier-queries.js');
      
      getSupplierById.mockResolvedValue({ id: 'supplier-123', isActive: true });
      getSupplierWithPriceLists.mockResolvedValue({ 
        priceLists: [{ id: 'pl-1', status: 'active' }] 
      });

      const response = await request(app)
        .delete('/api/suppliers/supplier-123')
        .expect(409);

      expect(response.body.error).toBe('Cannot deactivate supplier with active price lists');
    });
  });

  describe('POST /api/suppliers/:id/price-lists/upload', () => {
    test('should upload price list file', async () => {
      const { getUploadQueue } = await import('../../utils/upload-queue.js');
      const mockQueue = {
        addUpload: jest.fn().mockResolvedValue({
          id: 'upload-123',
          status: 'queued'
        })
      };
      getUploadQueue.mockReturnValue(mockQueue);

      const { getSupplierById } = await import('../../db/supplier-queries.js');
      getSupplierById.mockResolvedValue({ id: 'supplier-123' });

      const response = await request(app)
        .post('/api/suppliers/supplier-123/price-lists/upload')
        .attach('file', Buffer.from('SKU,Price\nPROD001,10.99'), 'prices.csv')
        .expect(202);

      expect(response.body.uploadId).toBe('upload-123');
      expect(response.body.status).toBe('queued');
      expect(mockQueue.addUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          supplierId: 'supplier-123'
        })
      );
    });

    test('should validate file type', async () => {
      const response = await request(app)
        .post('/api/suppliers/supplier-123/price-lists/upload')
        .attach('file', Buffer.from('binary data'), 'file.exe')
        .expect(400);

      expect(response.body.error).toContain('Unsupported file type');
    });

    test('should enforce file size limit', async () => {
      const largeBuffer = Buffer.alloc(11 * 1024 * 1024); // 11MB
      
      const response = await request(app)
        .post('/api/suppliers/supplier-123/price-lists/upload')
        .attach('file', largeBuffer, 'large.csv')
        .expect(413);

      expect(response.body.error).toContain('File too large');
    });

    test('should handle upload queue errors', async () => {
      const { getUploadQueue } = await import('../../utils/upload-queue.js');
      const mockQueue = {
        addUpload: jest.fn().mockRejectedValue(new Error('Queue full'))
      };
      getUploadQueue.mockReturnValue(mockQueue);

      const { getSupplierById } = await import('../../db/supplier-queries.js');
      getSupplierById.mockResolvedValue({ id: 'supplier-123' });

      const response = await request(app)
        .post('/api/suppliers/supplier-123/price-lists/upload')
        .attach('file', Buffer.from('data'), 'prices.csv')
        .expect(503);

      expect(response.body.error).toBe('Upload service temporarily unavailable');
    });
  });

  describe('GET /api/suppliers/:id/price-lists', () => {
    test('should get supplier price lists', async () => {
      const mockPriceLists = [
        { id: 'pl-1', name: 'Q1 2024', status: 'active' },
        { id: 'pl-2', name: 'Q2 2024', status: 'pending' }
      ];

      const { getSupplierWithPriceLists } = await import('../../db/supplier-queries.js');
      getSupplierWithPriceLists.mockResolvedValue({
        id: 'supplier-123',
        priceLists: mockPriceLists
      });

      const response = await request(app)
        .get('/api/suppliers/supplier-123/price-lists')
        .expect(200);

      expect(response.body).toEqual(mockPriceLists);
    });

    test('should filter by status', async () => {
      const { getSupplierWithPriceLists } = await import('../../db/supplier-queries.js');
      getSupplierWithPriceLists.mockResolvedValue({
        id: 'supplier-123',
        priceLists: []
      });

      await request(app)
        .get('/api/suppliers/supplier-123/price-lists?status=active')
        .expect(200);

      expect(getSupplierWithPriceLists).toHaveBeenCalledWith(
        'supplier-123',
        { status: 'active' }
      );
    });
  });

  describe('POST /api/suppliers/bulk-update', () => {
    test('should bulk update suppliers', async () => {
      const updates = [
        { id: 'supplier-1', updates: { paymentTerms: 30 } },
        { id: 'supplier-2', updates: { paymentTerms: 45 } }
      ];

      const { bulkUpdateSuppliers } = await import('../../db/supplier-queries.js');
      bulkUpdateSuppliers.mockResolvedValue({
        successful: 2,
        failed: 0,
        results: updates.map(u => ({ ...u, success: true }))
      });

      const response = await request(app)
        .post('/api/suppliers/bulk-update')
        .send({ updates })
        .expect(200);

      expect(response.body.successful).toBe(2);
      expect(response.body.failed).toBe(0);
    });

    test('should handle partial failures', async () => {
      const updates = [
        { id: 'supplier-1', updates: { paymentTerms: 30 } },
        { id: 'invalid-id', updates: { paymentTerms: 45 } }
      ];

      const { bulkUpdateSuppliers } = await import('../../db/supplier-queries.js');
      bulkUpdateSuppliers.mockResolvedValue({
        successful: 1,
        failed: 1,
        results: [
          { id: 'supplier-1', success: true },
          { id: 'invalid-id', success: false, error: 'Not found' }
        ]
      });

      const response = await request(app)
        .post('/api/suppliers/bulk-update')
        .send({ updates })
        .expect(207); // Multi-status

      expect(response.body.successful).toBe(1);
      expect(response.body.failed).toBe(1);
    });
  });

  describe('GET /api/suppliers/:id/performance', () => {
    test('should get supplier performance metrics', async () => {
      const mockPerformance = {
        supplier: { id: 'supplier-123' },
        leadTimeMetrics: {
          averageLeadTime: 7,
          totalProducts: 50
        },
        inventoryMetrics: {
          itemsNeedingReorder: 5,
          totalValueAtRisk: 10000
        },
        overallScore: {
          overall: 85,
          reliability: 90,
          pricing: 80
        }
      };

      const { getSupplierPerformance } = await import('../../db/supplier-queries.js');
      getSupplierPerformance.mockResolvedValue(mockPerformance);

      const response = await request(app)
        .get('/api/suppliers/supplier-123/performance')
        .expect(200);

      expect(response.body).toEqual(mockPerformance);
    });

    test('should include date range filter', async () => {
      const { getSupplierPerformance } = await import('../../db/supplier-queries.js');
      getSupplierPerformance.mockResolvedValue({});

      await request(app)
        .get('/api/suppliers/supplier-123/performance?startDate=2024-01-01&endDate=2024-03-31')
        .expect(200);

      expect(getSupplierPerformance).toHaveBeenCalledWith(
        'supplier-123',
        {
          startDate: '2024-01-01',
          endDate: '2024-03-31'
        }
      );
    });
  });

  describe('Rate Limiting', () => {
    test('should rate limit upload endpoints', async () => {
      const { getUploadQueue } = await import('../../utils/upload-queue.js');
      const mockQueue = { addUpload: jest.fn().mockResolvedValue({ id: 'test' }) };
      getUploadQueue.mockReturnValue(mockQueue);

      const { getSupplierById } = await import('../../db/supplier-queries.js');
      getSupplierById.mockResolvedValue({ id: 'supplier-123' });

      // Make multiple requests
      const requests = Array(15).fill(null).map(() =>
        request(app)
          .post('/api/suppliers/supplier-123/price-lists/upload')
          .attach('file', Buffer.from('data'), 'test.csv')
      );

      const responses = await Promise.all(requests);
      const tooManyRequests = responses.filter(r => r.status === 429);

      expect(tooManyRequests.length).toBeGreaterThan(0);
      expect(tooManyRequests[0].body.error).toContain('Too many upload requests');
    });
  });

  describe('Error Handling', () => {
    test('should handle multer errors gracefully', async () => {
      const response = await request(app)
        .post('/api/suppliers/supplier-123/price-lists/upload')
        .expect(400);

      expect(response.body.error).toContain('No file uploaded');
    });

    test('should handle unexpected errors', async () => {
      const { getSuppliers } = await import('../../db/supplier-queries.js');
      getSuppliers.mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      const response = await request(app)
        .get('/api/suppliers')
        .expect(500);

      expect(response.body.error).toBe('Unexpected error');
    });

    test('should sanitize error messages', async () => {
      const { getSuppliers } = await import('../../db/supplier-queries.js');
      getSuppliers.mockRejectedValue(new Error('SELECT * FROM sensitive_table'));

      const response = await request(app)
        .get('/api/suppliers')
        .expect(500);

      expect(response.body.error).not.toContain('sensitive_table');
      expect(response.body.error).toBe('Internal server error');
    });
  });
});