import { getEnhancedUploadQueue, UPLOAD_PRIORITY } from './upload-queue-enhanced.js';
import { getUploadWebSocketHandler } from './upload-websocket-handler.js';
import { getUploadRateLimiter } from './upload-rate-limiter.js';

// Integrated upload queue with rate limiting
export class IntegratedUploadQueue {
  constructor(options = {}) {
    // Initialize enhanced upload queue
    this.uploadQueue = getEnhancedUploadQueue({
      ...options.queue,
      enableWebSocket: false // We'll handle WebSocket separately
    });
    
    // Initialize rate limiter
    this.rateLimiter = getUploadRateLimiter(options.rateLimiter);
    
    // Initialize WebSocket handler
    this.wsHandler = getUploadWebSocketHandler({
      ...options.websocket,
      uploadQueue: this.uploadQueue
    });
    
    // Wrap the original enqueue method with rate limiting
    this.originalEnqueue = this.uploadQueue.enqueue.bind(this.uploadQueue);
    this.uploadQueue.enqueue = this.enqueueWithRateLimit.bind(this);
    
    // Set up upload lifecycle hooks
    this.setupLifecycleHooks();
  }
  
  // Start all services
  async start() {
    // Start WebSocket server
    await this.wsHandler.start();
    
    console.log('✅ Integrated Upload Queue started');
    console.log('📡 WebSocket server running on port', this.wsHandler.port);
    console.log('🚦 Rate limiting enabled');
  }
  
  // Enqueue with rate limiting
  async enqueueWithRateLimit(uploadData) {
    const { supplierId, userId } = uploadData;
    
    // Check rate limits
    const rateLimitCheck = await this.rateLimiter.checkUploadAllowed(uploadData);
    
    if (!rateLimitCheck.allowed) {
      // Log rate limit violation
      console.warn('⚠️ Upload rate limited:', {
        supplierId,
        userId,
        errors: rateLimitCheck.errors,
        usage: rateLimitCheck.usage
      });
      
      // Emit rate limit event
      this.uploadQueue.emit('upload:rate_limited', {
        uploadData,
        rateLimitCheck
      });
      
      // Broadcast rate limit to WebSocket clients
      this.wsHandler.broadcastToSupplier(supplierId, {
        type: 'upload:rate_limited',
        errors: rateLimitCheck.errors,
        usage: rateLimitCheck.usage,
        limits: rateLimitCheck.limits
      });
      
      throw new Error(`Rate limit exceeded: ${rateLimitCheck.errors.join(', ')}`);
    }
    
    // Apply throttle delay if needed
    if (rateLimitCheck.throttleDelay > 0) {
      console.log(`⏱️ Applying throttle delay: ${rateLimitCheck.throttleDelay}ms`);
      uploadData.metadata = {
        ...uploadData.metadata,
        throttled: true,
        throttleDelay: rateLimitCheck.throttleDelay
      };
      
      // Add delay to job options
      uploadData.delay = rateLimitCheck.throttleDelay;
    }
    
    // Add rate limit warnings to metadata
    if (rateLimitCheck.warnings && rateLimitCheck.warnings.length > 0) {
      uploadData.metadata = {
        ...uploadData.metadata,
        rateLimitWarnings: rateLimitCheck.warnings
      };
    }
    
    // Increment concurrent counters
    this.rateLimiter.incrementConcurrent(supplierId, userId);
    
    try {
      // Call original enqueue
      const result = await this.originalEnqueue(uploadData);
      
      // Emit successful enqueue event with rate limit info
      this.uploadQueue.emit('upload:enqueued_with_limits', {
        uploadData,
        result,
        rateLimitStatus: await this.rateLimiter.getRateLimitStatus(supplierId, userId)
      });
      
      return result;
    } catch (error) {
      // Decrement concurrent counters on failure
      this.rateLimiter.decrementConcurrent(supplierId, userId);
      throw error;
    }
  }
  
  // Set up lifecycle hooks for rate limiting
  setupLifecycleHooks() {
    // When upload completes, decrement concurrent counters
    this.uploadQueue.on('upload:completed', (upload) => {
      this.rateLimiter.decrementConcurrent(upload.supplierId, upload.userId);
    });
    
    // When upload fails, decrement concurrent counters
    this.uploadQueue.on('upload:failed', (upload) => {
      this.rateLimiter.decrementConcurrent(upload.supplierId, upload.userId);
    });
    
    // When upload is cancelled, decrement concurrent counters
    this.uploadQueue.on('upload:cancelled', (upload) => {
      this.rateLimiter.decrementConcurrent(upload.supplierId, upload.userId);
    });
    
    // Periodic rate limit status broadcast
    setInterval(async () => {
      const concurrentStatus = {
        global: this.rateLimiter.concurrentUploads.global,
        bySupplier: Object.fromEntries(this.rateLimiter.concurrentUploads.bySupplier),
        byUser: Object.fromEntries(this.rateLimiter.concurrentUploads.byUser)
      };
      
      this.wsHandler.broadcastToAll({
        type: 'rate_limit:status',
        concurrent: concurrentStatus,
        limits: this.rateLimiter.getLimitsConfiguration()
      });
    }, 30000); // Every 30 seconds
  }
  
  // Get comprehensive status including rate limits
  async getStatus() {
    const queueStats = await this.uploadQueue.getStatistics();
    const queueHealth = await this.uploadQueue.getHealthStatus();
    const rateLimits = this.rateLimiter.getLimitsConfiguration();
    const wsClients = this.wsHandler.getClientsInfo();
    
    return {
      queue: queueStats,
      health: queueHealth,
      rateLimits: rateLimits,
      concurrent: {
        global: this.rateLimiter.concurrentUploads.global,
        maxGlobal: rateLimits.global.maxConcurrent,
        bySupplier: Object.fromEntries(this.rateLimiter.concurrentUploads.bySupplier),
        byUser: Object.fromEntries(this.rateLimiter.concurrentUploads.byUser)
      },
      websocket: {
        connected: wsClients.length,
        clients: wsClients
      }
    };
  }
  
  // Get rate limit status for specific supplier/user
  async getRateLimitStatus(supplierId, userId) {
    return await this.rateLimiter.getRateLimitStatus(supplierId, userId);
  }
  
  // Reset rate limits (admin function)
  async resetRateLimits(type, key) {
    return await this.rateLimiter.resetLimits(type, key);
  }
  
  // Graceful shutdown
  async shutdown() {
    console.log('🛑 Shutting down integrated upload queue...');
    
    // Stop accepting new uploads
    await this.uploadQueue.pauseAllQueues();
    
    // Wait for active uploads to complete
    const timeout = 30000;
    const startTime = Date.now();
    
    while (this.uploadQueue.processingTotal.size > 0 && Date.now() - startTime < timeout) {
      console.log(`⏳ Waiting for ${this.uploadQueue.processingTotal.size} active uploads...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Stop WebSocket server
    await this.wsHandler.stop();
    
    // Destroy rate limiter
    await this.rateLimiter.destroy();
    
    // Destroy upload queue
    await this.uploadQueue.destroy();
    
    console.log('✅ Integrated upload queue shutdown complete');
  }
}

// Factory function to create integrated upload queue
export async function createIntegratedUploadQueue(options = {}) {
  const defaultOptions = {
    queue: {
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD
      },
      maxConcurrentPerSupplier: 5,
      maxConcurrentTotal: 20,
      retryAttempts: 3,
      retryDelay: 2000,
      maxRetryDelay: 60000
    },
    rateLimiter: {
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD
      },
      supplierPerMinute: 10,
      supplierPerHour: 100,
      supplierPerDay: 1000,
      userPerMinute: 20,
      userPerHour: 200,
      userPerDay: 2000,
      globalPerMinute: 100,
      globalPerHour: 1000,
      maxConcurrentPerSupplier: 5,
      maxConcurrentPerUser: 10,
      maxConcurrentGlobal: 50
    },
    websocket: {
      port: 4001,
      heartbeatInterval: 30000,
      statsInterval: 10000
    }
  };
  
  // Merge options
  const mergedOptions = {
    queue: { ...defaultOptions.queue, ...options.queue },
    rateLimiter: { ...defaultOptions.rateLimiter, ...options.rateLimiter },
    websocket: { ...defaultOptions.websocket, ...options.websocket }
  };
  
  const integratedQueue = new IntegratedUploadQueue(mergedOptions);
  await integratedQueue.start();
  
  return integratedQueue;
}

// Express middleware for upload queue integration
export function createUploadQueueMiddleware(integratedQueue) {
  return async (req, res, next) => {
    // Attach queue to request
    req.uploadQueue = integratedQueue;
    
    // Helper function to enqueue upload
    req.enqueueUpload = async (uploadData) => {
      try {
        const result = await integratedQueue.uploadQueue.enqueue({
          ...uploadData,
          userId: req.user?.id || uploadData.userId,
          metadata: {
            ...uploadData.metadata,
            ip: req.ip,
            userAgent: req.headers['user-agent']
          }
        });
        
        return result;
      } catch (error) {
        if (error.message.includes('Rate limit exceeded')) {
          res.status(429).json({
            error: 'Too Many Requests',
            message: error.message,
            retryAfter: 60
          });
          throw error;
        }
        throw error;
      }
    };
    
    // Helper to get upload status
    req.getUploadStatus = async (uploadId) => {
      return await integratedQueue.uploadQueue.getUploadStatus(uploadId);
    };
    
    // Helper to get rate limit status
    req.getRateLimitStatus = async () => {
      const supplierId = req.body?.supplierId || req.query?.supplierId;
      const userId = req.user?.id;
      
      if (!supplierId || !userId) {
        return null;
      }
      
      return await integratedQueue.getRateLimitStatus(supplierId, userId);
    };
    
    next();
  };
}

// Example usage
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    try {
      // Create integrated upload queue
      const queue = await createIntegratedUploadQueue({
        queue: {
          maxConcurrentPerSupplier: 3,
          maxConcurrentTotal: 15
        },
        rateLimiter: {
          supplierPerMinute: 5,
          supplierPerHour: 50
        }
      });
      
      // Monitor status
      setInterval(async () => {
        const status = await queue.getStatus();
        console.log('\n📊 System Status:');
        console.log(`Queue: ${status.queue.queue.total} | Processing: ${status.queue.processing.total}`);
        console.log(`Concurrent: ${status.concurrent.global}/${status.concurrent.maxGlobal}`);
        console.log(`WebSocket Clients: ${status.websocket.connected}`);
        console.log(`Health: ${status.health.status}`);
      }, 10000);
      
      // Handle shutdown
      process.on('SIGINT', async () => {
        await queue.shutdown();
        process.exit(0);
      });
      
      console.log('\n🚀 Integrated Upload Queue is running!');
      console.log('Press Ctrl+C to shutdown\n');
      
    } catch (error) {
      console.error('Failed to start:', error);
      process.exit(1);
    }
  })();
}