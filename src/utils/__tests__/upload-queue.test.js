import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { 
  getUploadQueue, 
  createPriceListUploadProcessor,
  UPLOAD_STATUS,
  UPLOAD_PRIORITY,
  resetQueue
} from '../upload-queue.js';
import EventEmitter from 'events';

// Mock dependencies
jest.mock('../file-parsers/index.js', () => ({
  parsePriceListFile: jest.fn(),
  validatePriceListData: jest.fn(),
  standardizePriceListData: jest.fn()
}));

jest.mock('../../db/price-list-queries.js', () => ({
  createPriceList: jest.fn(),
  createPriceListItems: jest.fn()
}));

describe('Upload Queue', () => {
  let queue;

  beforeEach(() => {
    jest.clearAllMocks();
    resetQueue(); // Reset singleton instance
    queue = getUploadQueue({
      maxConcurrent: 3,
      retryAttempts: 2,
      retryDelay: 100
    });
  });

  afterEach(() => {
    if (queue && queue.close) {
      queue.close();
    }
  });

  describe('Queue Management', () => {
    test('should create singleton queue instance', () => {
      const queue1 = getUploadQueue();
      const queue2 = getUploadQueue();
      
      expect(queue1).toBe(queue2);
    });

    test('should add upload to queue', async () => {
      const upload = {
        id: 'upload-1',
        file: { filename: 'test.csv', buffer: Buffer.from('data') },
        supplierId: 'supplier-1',
        userId: 'user-1'
      };

      const result = await queue.addUpload(upload);

      expect(result.id).toBe('upload-1');
      expect(result.status).toBe(UPLOAD_STATUS.QUEUED);
      expect(result.priority).toBe(UPLOAD_PRIORITY.NORMAL);
    });

    test('should handle priority uploads', async () => {
      const normalUpload = {
        id: 'normal-1',
        file: { filename: 'normal.csv' },
        priority: UPLOAD_PRIORITY.NORMAL
      };

      const highUpload = {
        id: 'high-1',
        file: { filename: 'high.csv' },
        priority: UPLOAD_PRIORITY.HIGH
      };

      const lowUpload = {
        id: 'low-1',
        file: { filename: 'low.csv' },
        priority: UPLOAD_PRIORITY.LOW
      };

      await queue.addUpload(normalUpload);
      await queue.addUpload(highUpload);
      await queue.addUpload(lowUpload);

      const stats = queue.getStatistics();
      expect(stats.queue.byPriority.high).toBe(1);
      expect(stats.queue.byPriority.normal).toBe(1);
      expect(stats.queue.byPriority.low).toBe(1);
    });

    test('should process uploads concurrently', async () => {
      const processor = jest.fn().mockImplementation(async (upload) => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return { success: true, data: { id: upload.id } };
      });

      queue.setProcessor(processor);

      const uploads = Array(5).fill(null).map((_, i) => ({
        id: `upload-${i}`,
        file: { filename: `file-${i}.csv` }
      }));

      const promises = uploads.map(u => queue.addUpload(u));
      
      // Wait a bit to let processing start
      await new Promise(resolve => setTimeout(resolve, 50));

      const stats = queue.getStatistics();
      expect(stats.processing.total).toBe(3); // maxConcurrent = 3
      expect(stats.queue.total).toBe(2); // 2 still queued

      await Promise.all(promises);
    });

    test('should handle upload cancellation', async () => {
      const processor = jest.fn().mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return { success: true };
      });

      queue.setProcessor(processor);

      const upload = {
        id: 'cancel-1',
        file: { filename: 'cancel.csv' }
      };

      queue.addUpload(upload);
      
      // Cancel before processing completes
      const cancelResult = await queue.cancelUpload('cancel-1');

      expect(cancelResult.success).toBe(true);
      expect(cancelResult.upload.status).toBe(UPLOAD_STATUS.CANCELLED);
    });

    test('should retry failed uploads', async () => {
      let attempts = 0;
      const processor = jest.fn().mockImplementation(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Processing failed');
        }
        return { success: true };
      });

      queue.setProcessor(processor);

      const upload = {
        id: 'retry-1',
        file: { filename: 'retry.csv' }
      };

      await queue.addUpload(upload);

      // Wait for retries
      await new Promise(resolve => setTimeout(resolve, 500));

      expect(processor).toHaveBeenCalledTimes(3);
      const stats = queue.getStatistics();
      expect(stats.performance.totalRetries).toBeGreaterThan(0);
    });

    test('should emit events during upload lifecycle', async () => {
      const events = [];
      const eventTypes = [
        'upload:queued',
        'upload:started',
        'upload:completed',
        'upload:progress'
      ];

      eventTypes.forEach(event => {
        queue.on(event, (data) => {
          events.push({ type: event, data });
        });
      });

      const processor = jest.fn().mockResolvedValue({ success: true });
      queue.setProcessor(processor);

      await queue.addUpload({
        id: 'event-1',
        file: { filename: 'events.csv' }
      });

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(events.some(e => e.type === 'upload:queued')).toBe(true);
      expect(events.some(e => e.type === 'upload:started')).toBe(true);
      expect(events.some(e => e.type === 'upload:completed')).toBe(true);
    });
  });

  describe('Upload Processing', () => {
    test('should process CSV file upload', async () => {
      const { parsePriceListFile, validatePriceListData, standardizePriceListData } = 
        await import('../file-parsers/index.js');
      const { createPriceList, createPriceListItems } = 
        await import('../../db/price-list-queries.js');

      parsePriceListFile.mockResolvedValue({
        success: true,
        data: [
          { sku: 'PROD001', unitPrice: 10.99 }
        ]
      });

      validatePriceListData.mockReturnValue({
        valid: true,
        errors: []
      });

      standardizePriceListData.mockReturnValue({
        priceList: { id: 'pl-1' },
        items: [{ sku: 'PROD001', unitPrice: 10.99 }]
      });

      createPriceList.mockResolvedValue({ id: 'pl-1' });
      createPriceListItems.mockResolvedValue({ count: 1 });

      const processor = createPriceListUploadProcessor();
      const result = await processor({
        file: {
          filename: 'test.csv',
          mimeType: 'text/csv',
          buffer: Buffer.from('data')
        },
        supplierId: 'supplier-1',
        userId: 'user-1'
      });

      expect(result.success).toBe(true);
      expect(result.priceListId).toBe('pl-1');
      expect(result.itemCount).toBe(1);
    });

    test('should handle parsing errors', async () => {
      const { parsePriceListFile } = await import('../file-parsers/index.js');

      parsePriceListFile.mockResolvedValue({
        success: false,
        error: 'Invalid file format'
      });

      const processor = createPriceListUploadProcessor();
      const result = await processor({
        file: { filename: 'bad.csv', buffer: Buffer.from('bad data') },
        supplierId: 'supplier-1'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid file format');
    });

    test('should handle validation errors', async () => {
      const { parsePriceListFile, validatePriceListData } = 
        await import('../file-parsers/index.js');

      parsePriceListFile.mockResolvedValue({
        success: true,
        data: [{ sku: '', unitPrice: -1 }]
      });

      validatePriceListData.mockReturnValue({
        valid: false,
        errors: ['SKU is required', 'Price must be positive']
      });

      const processor = createPriceListUploadProcessor();
      const result = await processor({
        file: { filename: 'invalid.csv', buffer: Buffer.from('data') },
        supplierId: 'supplier-1'
      });

      expect(result.success).toBe(false);
      expect(result.validationErrors).toHaveLength(2);
    });

    test('should handle database errors', async () => {
      const { parsePriceListFile, validatePriceListData, standardizePriceListData } = 
        await import('../file-parsers/index.js');
      const { createPriceList } = await import('../../db/price-list-queries.js');

      parsePriceListFile.mockResolvedValue({ success: true, data: [] });
      validatePriceListData.mockReturnValue({ valid: true });
      standardizePriceListData.mockReturnValue({ priceList: {}, items: [] });
      createPriceList.mockRejectedValue(new Error('Database error'));

      const processor = createPriceListUploadProcessor();
      const result = await processor({
        file: { filename: 'test.csv', buffer: Buffer.from('data') },
        supplierId: 'supplier-1'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Database error');
    });
  });

  describe('Concurrent Upload Scenarios', () => {
    test('should handle multiple users uploading simultaneously', async () => {
      const processor = jest.fn().mockImplementation(async (upload) => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return { success: true, userId: upload.userId };
      });

      queue.setProcessor(processor);

      const users = ['user-1', 'user-2', 'user-3'];
      const uploads = users.flatMap(userId => 
        Array(3).fill(null).map((_, i) => ({
          id: `${userId}-upload-${i}`,
          file: { filename: `${userId}-file-${i}.csv` },
          userId
        }))
      );

      const promises = uploads.map(u => queue.addUpload(u));
      const results = await Promise.all(promises);

      expect(results).toHaveLength(9);
      expect(processor).toHaveBeenCalledTimes(9);
      
      // Verify each user's uploads were processed
      users.forEach(userId => {
        const userUploads = results.filter(r => r.userId === userId);
        expect(userUploads).toHaveLength(3);
      });
    });

    test('should handle same supplier multiple uploads', async () => {
      const processor = jest.fn().mockResolvedValue({ success: true });
      queue.setProcessor(processor);

      const supplierId = 'supplier-1';
      const uploads = Array(5).fill(null).map((_, i) => ({
        id: `upload-${i}`,
        file: { filename: `pricelist-v${i}.csv` },
        supplierId
      }));

      await Promise.all(uploads.map(u => queue.addUpload(u)));

      const stats = queue.getStatistics();
      expect(stats.completed.total).toBe(5);
    });

    test('should handle queue under heavy load', async () => {
      const processor = jest.fn().mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return { success: true };
      });

      queue.setProcessor(processor);

      // Simulate heavy load
      const uploadCount = 100;
      const uploads = Array(uploadCount).fill(null).map((_, i) => ({
        id: `load-${i}`,
        file: { filename: `file-${i}.csv` },
        priority: i % 3 === 0 ? UPLOAD_PRIORITY.HIGH : UPLOAD_PRIORITY.NORMAL
      }));

      const startTime = Date.now();
      const promises = uploads.map(u => queue.addUpload(u));

      // Monitor queue health during processing
      const healthChecks = [];
      const healthInterval = setInterval(() => {
        healthChecks.push(queue.getHealthStatus());
      }, 100);

      await Promise.all(promises);
      clearInterval(healthInterval);

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(processor).toHaveBeenCalledTimes(uploadCount);
      expect(healthChecks.some(h => h.status === 'degraded')).toBe(false);
      
      // Should process efficiently with concurrent limit
      expect(duration).toBeLessThan(uploadCount * 10 / 3 * 2); // Some overhead allowed
    });

    test('should handle memory efficiently with large files', async () => {
      const largeBuffer = Buffer.alloc(5 * 1024 * 1024); // 5MB
      
      const processor = jest.fn().mockImplementation(async (upload) => {
        // Simulate processing that checks memory
        const memUsage = process.memoryUsage();
        return { 
          success: true, 
          memoryUsed: memUsage.heapUsed 
        };
      });

      queue.setProcessor(processor);

      const uploads = Array(10).fill(null).map((_, i) => ({
        id: `large-${i}`,
        file: { 
          filename: `large-${i}.csv`,
          buffer: largeBuffer
        }
      }));

      const results = await Promise.all(uploads.map(u => queue.addUpload(u)));

      expect(results).toHaveLength(10);
      
      // Memory should be managed efficiently
      const memoryStats = results.map(r => r.memoryUsed);
      const avgMemory = memoryStats.reduce((a, b) => a + b, 0) / memoryStats.length;
      const peakMemory = Math.max(...memoryStats);
      
      // Peak memory should not be drastically higher than average
      expect(peakMemory).toBeLessThan(avgMemory * 2);
    });
  });

  describe('Error Scenarios', () => {
    test('should handle network failures gracefully', async () => {
      let networkFails = true;
      const processor = jest.fn().mockImplementation(async () => {
        if (networkFails) {
          throw new Error('Network timeout');
        }
        return { success: true };
      });

      queue.setProcessor(processor);

      const upload = {
        id: 'network-fail-1',
        file: { filename: 'test.csv' }
      };

      const uploadPromise = queue.addUpload(upload);

      // Simulate network recovery after some retries
      setTimeout(() => {
        networkFails = false;
      }, 250);

      const result = await uploadPromise;
      
      expect(processor.mock.calls.length).toBeGreaterThan(1);
      expect(result.retryCount).toBeGreaterThan(0);
    });

    test('should handle database connection errors', async () => {
      const { createPriceList } = await import('../../db/price-list-queries.js');
      
      let dbFails = true;
      createPriceList.mockImplementation(async () => {
        if (dbFails) {
          throw new Error('Connection pool exhausted');
        }
        return { id: 'pl-1' };
      });

      const processor = createPriceListUploadProcessor();
      
      const result = await processor({
        file: { filename: 'test.csv', buffer: Buffer.from('data') },
        supplierId: 'supplier-1'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection pool exhausted');
    });

    test('should handle file corruption during processing', async () => {
      const processor = jest.fn().mockImplementation(async (upload) => {
        if (upload.file.buffer.length === 0) {
          throw new Error('Corrupted file data');
        }
        return { success: true };
      });

      queue.setProcessor(processor);

      const corruptUpload = {
        id: 'corrupt-1',
        file: { 
          filename: 'corrupt.csv',
          buffer: Buffer.alloc(0) // Empty buffer simulates corruption
        }
      };

      const result = await queue.addUpload(corruptUpload);
      
      expect(result.status).toBe(UPLOAD_STATUS.FAILED);
      expect(result.error).toContain('Corrupted file data');
    });

    test('should handle permission errors', async () => {
      const processor = jest.fn().mockImplementation(async (upload) => {
        if (!upload.userId) {
          throw new Error('Unauthorized: User not authenticated');
        }
        return { success: true };
      });

      queue.setProcessor(processor);

      const unauthorizedUpload = {
        id: 'unauth-1',
        file: { filename: 'test.csv' },
        supplierId: 'supplier-1'
        // Missing userId
      };

      const result = await queue.addUpload(unauthorizedUpload);
      
      expect(result.status).toBe(UPLOAD_STATUS.FAILED);
      expect(result.error).toContain('Unauthorized');
    });
  });

  describe('Performance and Monitoring', () => {
    test('should track performance metrics accurately', async () => {
      const processor = jest.fn().mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return { success: true };
      });

      queue.setProcessor(processor);

      const uploads = Array(10).fill(null).map((_, i) => ({
        id: `perf-${i}`,
        file: { filename: `file-${i}.csv` }
      }));

      await Promise.all(uploads.map(u => queue.addUpload(u)));

      const stats = queue.getStatistics();
      
      expect(stats.performance.successRate).toBe(100);
      expect(stats.performance.averageProcessingTime).toBeGreaterThan(90);
      expect(stats.performance.averageProcessingTime).toBeLessThan(150);
      expect(stats.performance.totalProcessed).toBe(10);
    });

    test('should provide accurate health status', async () => {
      const processor = jest.fn().mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
        return { success: true };
      });

      queue.setProcessor(processor);

      // Fill queue to capacity
      const uploads = Array(20).fill(null).map((_, i) => ({
        id: `health-${i}`,
        file: { filename: `file-${i}.csv` }
      }));

      uploads.forEach(u => queue.addUpload(u));

      // Check health while under load
      const health = queue.getHealthStatus();
      
      expect(health.status).toBe('degraded'); // Queue is full
      expect(health.queueLength).toBeGreaterThan(10);
      expect(health.processingCount).toBe(3); // maxConcurrent
      expect(health.issues).toContain('Queue is near capacity');
    });

    test('should monitor memory usage', () => {
      const health = queue.getHealthStatus();
      
      expect(health.memoryUsage).toBeDefined();
      expect(health.memoryUsage.heapUsed).toBeGreaterThan(0);
      expect(health.memoryUsage.heapTotal).toBeGreaterThan(0);
      expect(health.uptime).toBeGreaterThan(0);
    });
  });
});