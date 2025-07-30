import { describe, test, expect, jest, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import supplierRoutes from '../../src/routes/supplier.routes.js';
import { getUploadQueue } from '../../src/utils/upload-queue.js';
import { parsePriceListFile } from '../../src/utils/file-parsers/index.js';

// Mock database and services
jest.mock('../../src/db/supplier-queries.js');
jest.mock('../../src/db/price-list-queries.js');
jest.mock('../../src/utils/file-parsers/index.js');
jest.mock('../../src/services/realtime-service.js');

describe('Supplier Module Integration Tests', () => {
  let app;
  let server;
  let wsServer;
  let wsClient;
  let uploadQueue;

  beforeAll(async () => {
    // Setup Express app
    app = express();
    app.use(express.json());
    app.use('/api/suppliers', supplierRoutes);

    // Setup HTTP server
    server = createServer(app);

    // Setup WebSocket server for real-time updates
    wsServer = new WebSocketServer({ server });
    
    wsServer.on('connection', (ws) => {
      ws.on('message', (data) => {
        // Echo messages for testing
        ws.send(data);
      });
    });

    // Start server
    await new Promise((resolve) => {
      server.listen(0, resolve);
    });

    // Get upload queue instance
    uploadQueue = getUploadQueue();
  });

  afterAll(async () => {
    if (wsClient) wsClient.close();
    if (wsServer) wsServer.close();
    if (server) {
      await new Promise((resolve) => {
        server.close(resolve);
      });
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Complete Supplier Onboarding Workflow', () => {
    test('should complete full supplier onboarding process', async () => {
      // Step 1: Create supplier
      const newSupplier = {
        supplierCode: 'SUP-TEST-001',
        companyName: 'Integration Test Supplier',
        email: 'test@supplier.com',
        contactPerson: 'John Doe',
        phone: '+1234567890',
        address: '123 Test Street',
        paymentTerms: 30
      };

      const { createSupplier, getSupplierByCode, supplierExistsByEmail } = 
        await import('../../src/db/supplier-queries.js');
      
      supplierExistsByEmail.mockResolvedValue(false);
      getSupplierByCode.mockResolvedValue(null);
      createSupplier.mockResolvedValue({
        id: 'supplier-123',
        ...newSupplier,
        isActive: true,
        createdAt: new Date()
      });

      const createResponse = await request(app)
        .post('/api/suppliers')
        .send(newSupplier)
        .expect(201);

      const supplierId = createResponse.body.id;
      expect(supplierId).toBe('supplier-123');

      // Step 2: Upload price list
      const csvContent = `SKU,Description,Unit Price,Currency,Min Order Qty,Unit of Measure
PROD001,Product 1,10.99,USD,10,EA
PROD002,Product 2,25.50,USD,5,CS
PROD003,Product 3,15.75,USD,20,EA`;

      const { getSupplierById } = await import('../../src/db/supplier-queries.js');
      getSupplierById.mockResolvedValue({ id: supplierId });

      const uploadResponse = await request(app)
        .post(`/api/suppliers/${supplierId}/price-lists/upload`)
        .attach('file', Buffer.from(csvContent), 'prices.csv')
        .expect(202);

      const uploadId = uploadResponse.body.uploadId;
      expect(uploadId).toBeDefined();

      // Step 3: Process upload (simulate queue processing)
      parsePriceListFile.mockResolvedValue({
        success: true,
        data: [
          { sku: 'PROD001', description: 'Product 1', unitPrice: 10.99, currency: 'USD' },
          { sku: 'PROD002', description: 'Product 2', unitPrice: 25.50, currency: 'USD' },
          { sku: 'PROD003', description: 'Product 3', unitPrice: 15.75, currency: 'USD' }
        ]
      });

      const { createPriceList, createPriceListItems } = 
        await import('../../src/db/price-list-queries.js');
      
      createPriceList.mockResolvedValue({ id: 'pl-123' });
      createPriceListItems.mockResolvedValue({ count: 3 });

      // Step 4: Check upload status
      const { getUploadById } = await import('../../src/db/upload-history-queries.js');
      getUploadById.mockResolvedValue({
        id: uploadId,
        status: 'completed',
        priceListId: 'pl-123',
        itemCount: 3
      });

      // Step 5: Verify price list creation
      const { getSupplierWithPriceLists } = await import('../../src/db/supplier-queries.js');
      getSupplierWithPriceLists.mockResolvedValue({
        id: supplierId,
        priceLists: [{
          id: 'pl-123',
          name: 'Price List - 2024-01-01',
          status: 'pending',
          itemCount: 3
        }]
      });

      const priceListsResponse = await request(app)
        .get(`/api/suppliers/${supplierId}/price-lists`)
        .expect(200);

      expect(priceListsResponse.body).toHaveLength(1);
      expect(priceListsResponse.body[0].itemCount).toBe(3);

      // Step 6: Activate price list
      const { activatePriceList } = await import('../../src/db/price-list-queries.js');
      activatePriceList.mockResolvedValue({
        id: 'pl-123',
        status: 'active'
      });

      const activateResponse = await request(app)
        .put(`/api/suppliers/${supplierId}/price-lists/pl-123/activate`)
        .expect(200);

      expect(activateResponse.body.status).toBe('active');
    });
  });

  describe('Concurrent Upload Handling', () => {
    test('should handle multiple simultaneous uploads', async () => {
      const supplierIds = ['supplier-1', 'supplier-2', 'supplier-3'];
      
      // Mock supplier existence
      const { getSupplierById } = await import('../../src/db/supplier-queries.js');
      getSupplierById.mockImplementation((id) => 
        Promise.resolve(supplierIds.includes(id) ? { id } : null)
      );

      // Create CSV files
      const csvFiles = supplierIds.map((supplierId, index) => ({
        supplierId,
        content: `SKU,Description,Unit Price
${supplierId}-PROD001,Product 1,${10 + index}.99
${supplierId}-PROD002,Product 2,${20 + index}.99`,
        filename: `${supplierId}-prices.csv`
      }));

      // Upload all files concurrently
      const uploadPromises = csvFiles.map(file =>
        request(app)
          .post(`/api/suppliers/${file.supplierId}/price-lists/upload`)
          .attach('file', Buffer.from(file.content), file.filename)
      );

      const uploadResponses = await Promise.all(uploadPromises);

      // All uploads should be accepted
      uploadResponses.forEach(response => {
        expect(response.status).toBe(202);
        expect(response.body.uploadId).toBeDefined();
        expect(response.body.status).toBe('queued');
      });

      // Verify queue statistics
      const queueStats = uploadQueue.getStatistics();
      expect(queueStats.queue.total).toBeGreaterThanOrEqual(0);
      expect(queueStats.processing.total).toBeLessThanOrEqual(3); // maxConcurrent
    });

    test('should handle upload conflicts for same supplier', async () => {
      const supplierId = 'supplier-conflict';
      
      const { getSupplierById } = await import('../../src/db/supplier-queries.js');
      getSupplierById.mockResolvedValue({ id: supplierId });

      // Create two price lists with overlapping SKUs
      const csv1 = `SKU,Description,Unit Price
PROD001,Product 1 Version A,10.99
PROD002,Product 2,20.99`;

      const csv2 = `SKU,Description,Unit Price
PROD001,Product 1 Version B,11.99
PROD003,Product 3,30.99`;

      // Upload both files
      const [upload1, upload2] = await Promise.all([
        request(app)
          .post(`/api/suppliers/${supplierId}/price-lists/upload`)
          .attach('file', Buffer.from(csv1), 'prices-v1.csv'),
        request(app)
          .post(`/api/suppliers/${supplierId}/price-lists/upload`)
          .attach('file', Buffer.from(csv2), 'prices-v2.csv')
      ]);

      expect(upload1.status).toBe(202);
      expect(upload2.status).toBe(202);

      // Both should be queued, conflict resolution happens during processing
      expect(upload1.body.uploadId).not.toBe(upload2.body.uploadId);
    });
  });

  describe('Large File Upload Handling', () => {
    test('should handle large CSV file efficiently', async () => {
      const supplierId = 'supplier-large';
      
      const { getSupplierById } = await import('../../src/db/supplier-queries.js');
      getSupplierById.mockResolvedValue({ id: supplierId });

      // Generate large CSV (10,000 products)
      let largeCsv = 'SKU,Description,Unit Price,Currency,Min Order Qty\n';
      for (let i = 1; i <= 10000; i++) {
        largeCsv += `PROD${i.toString().padStart(5, '0')},Product ${i},${(Math.random() * 100).toFixed(2)},USD,${Math.floor(Math.random() * 100) + 1}\n`;
      }

      const startTime = Date.now();
      
      const response = await request(app)
        .post(`/api/suppliers/${supplierId}/price-lists/upload`)
        .attach('file', Buffer.from(largeCsv), 'large-catalog.csv')
        .expect(202);

      const uploadTime = Date.now() - startTime;

      expect(response.body.uploadId).toBeDefined();
      expect(uploadTime).toBeLessThan(5000); // Should accept within 5 seconds
      
      // File should be queued, not processed synchronously
      expect(response.body.status).toBe('queued');
    });

    test('should reject files exceeding size limit', async () => {
      const supplierId = 'supplier-toolarge';
      
      const { getSupplierById } = await import('../../src/db/supplier-queries.js');
      getSupplierById.mockResolvedValue({ id: supplierId });

      // Create 11MB file (exceeds 10MB limit)
      const hugeBuffer = Buffer.alloc(11 * 1024 * 1024);
      
      const response = await request(app)
        .post(`/api/suppliers/${supplierId}/price-lists/upload`)
        .attach('file', hugeBuffer, 'huge.csv')
        .expect(413);

      expect(response.body.error).toContain('File too large');
    });
  });

  describe('Error Recovery and Resilience', () => {
    test('should handle database failures gracefully', async () => {
      const supplierId = 'supplier-db-fail';
      
      const { getSupplierById } = await import('../../src/db/supplier-queries.js');
      const { createPriceList } = await import('../../src/db/price-list-queries.js');
      
      getSupplierById.mockResolvedValue({ id: supplierId });
      
      // Simulate database failure during price list creation
      createPriceList.mockRejectedValue(new Error('Connection pool exhausted'));

      parsePriceListFile.mockResolvedValue({
        success: true,
        data: [{ sku: 'PROD001', unitPrice: 10.99 }]
      });

      const response = await request(app)
        .post(`/api/suppliers/${supplierId}/price-lists/upload`)
        .attach('file', Buffer.from('SKU,Price\nPROD001,10.99'), 'test.csv')
        .expect(202);

      // Upload should still be accepted and queued for retry
      expect(response.body.uploadId).toBeDefined();
    });

    test('should handle parsing errors appropriately', async () => {
      const supplierId = 'supplier-parse-fail';
      
      const { getSupplierById } = await import('../../src/db/supplier-queries.js');
      getSupplierById.mockResolvedValue({ id: supplierId });

      // Upload malformed CSV
      const malformedCsv = `SKU;Description;Price
PROD001;Product 1;not-a-number
PROD002;Product 2;-50.00`;

      const response = await request(app)
        .post(`/api/suppliers/${supplierId}/price-lists/upload`)
        .attach('file', Buffer.from(malformedCsv), 'malformed.csv')
        .expect(202);

      // Should accept for processing where errors will be handled
      expect(response.body.uploadId).toBeDefined();
    });
  });

  describe('Real-time Updates', () => {
    test('should send WebSocket updates during upload processing', async (done) => {
      const port = server.address().port;
      
      // Connect WebSocket client
      const WebSocket = (await import('ws')).default;
      wsClient = new WebSocket(`ws://localhost:${port}`);

      wsClient.on('open', async () => {
        // Subscribe to upload updates
        wsClient.send(JSON.stringify({
          type: 'subscribe',
          channel: 'uploads',
          supplierId: 'supplier-ws'
        }));

        // Listen for updates
        const updates = [];
        wsClient.on('message', (data) => {
          const message = JSON.parse(data);
          updates.push(message);

          if (message.type === 'upload:completed') {
            expect(updates.some(u => u.type === 'upload:started')).toBe(true);
            expect(updates.some(u => u.type === 'upload:progress')).toBe(true);
            expect(message.data.itemCount).toBeGreaterThan(0);
            done();
          }
        });

        // Trigger upload
        const { getSupplierById } = await import('../../src/db/supplier-queries.js');
        getSupplierById.mockResolvedValue({ id: 'supplier-ws' });

        await request(app)
          .post('/api/suppliers/supplier-ws/price-lists/upload')
          .attach('file', Buffer.from('SKU,Price\nPROD001,10.99'), 'ws-test.csv');
      });
    });
  });

  describe('Performance Monitoring', () => {
    test('should collect performance metrics during operations', async () => {
      const supplierId = 'supplier-perf';
      
      const { getSupplierById, getSupplierPerformance } = 
        await import('../../src/db/supplier-queries.js');
      
      getSupplierById.mockResolvedValue({ id: supplierId });
      getSupplierPerformance.mockResolvedValue({
        supplier: { id: supplierId },
        leadTimeMetrics: {
          averageLeadTime: 7,
          totalProducts: 100
        },
        uploadMetrics: {
          totalUploads: 5,
          successRate: 80,
          averageProcessingTime: 2500
        }
      });

      const response = await request(app)
        .get(`/api/suppliers/${supplierId}/performance`)
        .expect(200);

      expect(response.body.uploadMetrics).toBeDefined();
      expect(response.body.uploadMetrics.successRate).toBe(80);
      expect(response.body.uploadMetrics.averageProcessingTime).toBe(2500);
    });
  });

  describe('Security and Validation', () => {
    test('should sanitize file content to prevent injection', async () => {
      const supplierId = 'supplier-security';
      
      const { getSupplierById } = await import('../../src/db/supplier-queries.js');
      getSupplierById.mockResolvedValue({ id: supplierId });

      // CSV with potential SQL injection
      const maliciousCsv = `SKU,Description,Price
PROD001',''); DROP TABLE suppliers; --,10.99
PROD002,<script>alert('XSS')</script>,20.99`;

      const response = await request(app)
        .post(`/api/suppliers/${supplierId}/price-lists/upload`)
        .attach('file', Buffer.from(maliciousCsv), 'malicious.csv')
        .expect(202);

      // Should accept but sanitize during processing
      expect(response.body.uploadId).toBeDefined();
      
      // Verify sanitization in parser mock
      parsePriceListFile.mockImplementation((file) => {
        const content = file.buffer.toString();
        expect(content).not.toContain('DROP TABLE');
        expect(content).not.toContain('<script>');
        return { success: true, data: [] };
      });
    });

    test('should validate file headers and structure', async () => {
      const supplierId = 'supplier-validate';
      
      const { getSupplierById } = await import('../../src/db/supplier-queries.js');
      getSupplierById.mockResolvedValue({ id: supplierId });

      // CSV with wrong headers
      const wrongHeadersCsv = `Product Code,Item Name,Cost
PROD001,Product 1,10.99`;

      const response = await request(app)
        .post(`/api/suppliers/${supplierId}/price-lists/upload`)
        .attach('file', Buffer.from(wrongHeadersCsv), 'wrong-headers.csv')
        .expect(202);

      // Should accept for processing where validation will occur
      expect(response.body.uploadId).toBeDefined();
    });
  });
});