/**
 * Memory Optimization and Resource Management Utilities
 * Prevents memory leaks and optimizes resource usage
 */

import EventEmitter from 'events';
import { performance } from 'perf_hooks';

class MemoryOptimizer extends EventEmitter {
  constructor() {
    super();
    this.memoryThresholds = {
      warning: 0.8,  // 80% of heap limit
      critical: 0.9  // 90% of heap limit
    };
    this.activeConnections = new Set();
    this.intervalTimers = new Set();
    this.abortControllers = new Set();
    this.monitoringInterval = null;
    
    this.startMemoryMonitoring();
  }

  /**
   * Start memory monitoring
   */
  startMemoryMonitoring() {
    this.monitoringInterval = setInterval(() => {
      this.checkMemoryUsage();
    }, 30000); // Check every 30 seconds
  }

  /**
   * Check current memory usage
   */
  checkMemoryUsage() {
    const memUsage = process.memoryUsage();
    const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
    const heapTotalMB = memUsage.heapTotal / 1024 / 1024;
    const rssMB = memUsage.rss / 1024 / 1024;
    const externalMB = memUsage.external / 1024 / 1024;
    
    const heapUsagePercent = memUsage.heapUsed / memUsage.heapTotal;
    
    // Emit warnings based on thresholds
    if (heapUsagePercent > this.memoryThresholds.critical) {
      this.emit('memory:critical', {
        heapUsedMB,
        heapTotalMB,
        rssMB,
        externalMB,
        heapUsagePercent
      });
      this.triggerGarbageCollection();
    } else if (heapUsagePercent > this.memoryThresholds.warning) {
      this.emit('memory:warning', {
        heapUsedMB,
        heapTotalMB,
        rssMB,
        externalMB,
        heapUsagePercent
      });
    }

    return {
      heapUsedMB: Math.round(heapUsedMB),
      heapTotalMB: Math.round(heapTotalMB),
      rssMB: Math.round(rssMB),
      externalMB: Math.round(externalMB),
      heapUsagePercent: Math.round(heapUsagePercent * 100)
    };
  }

  /**
   * Force garbage collection if available
   */
  triggerGarbageCollection() {
    if (global.gc) {
      console.log('🗑️  Triggering garbage collection due to high memory usage');
      global.gc();
    } else {
      console.warn('⚠️  Garbage collection not exposed. Run with --expose-gc flag');
    }
  }

  /**
   * Register a connection for tracking
   */
  registerConnection(connection) {
    this.activeConnections.add(connection);
    
    // Clean up when connection closes
    const cleanup = () => {
      this.activeConnections.delete(connection);
    };
    
    if (connection.on) {
      connection.on('close', cleanup);
      connection.on('error', cleanup);
      connection.on('end', cleanup);
    }
    
    return cleanup;
  }

  /**
   * Register an interval timer for tracking
   */
  registerInterval(intervalId) {
    this.intervalTimers.add(intervalId);
    return () => {
      clearInterval(intervalId);
      this.intervalTimers.delete(intervalId);
    };
  }

  /**
   * Register an AbortController for cleanup
   */
  registerAbortController(controller) {
    this.abortControllers.add(controller);
    return () => {
      controller.abort();
      this.abortControllers.delete(controller);
    };
  }

  /**
   * Clean up all registered resources
   */
  cleanup() {
    // Clear all interval timers
    this.intervalTimers.forEach(intervalId => {
      clearInterval(intervalId);
    });
    this.intervalTimers.clear();

    // Abort all controllers
    this.abortControllers.forEach(controller => {
      try {
        controller.abort();
      } catch (error) {
        console.warn('Error aborting controller:', error.message);
      }
    });
    this.abortControllers.clear();

    // Close all connections
    this.activeConnections.forEach(connection => {
      try {
        if (connection.destroy) {
          connection.destroy();
        } else if (connection.close) {
          connection.close();
        } else if (connection.end) {
          connection.end();
        }
      } catch (error) {
        console.warn('Error closing connection:', error.message);
      }
    });
    this.activeConnections.clear();

    // Stop memory monitoring
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    console.log('🧹 Memory optimizer cleanup completed');
  }

  /**
   * Get resource usage statistics
   */
  getResourceStats() {
    return {
      activeConnections: this.activeConnections.size,
      intervalTimers: this.intervalTimers.size,
      abortControllers: this.abortControllers.size,
      memory: this.checkMemoryUsage()
    };
  }
}

/**
 * Object pool for reusing expensive objects
 */
class ObjectPool {
  constructor(createFn, resetFn, maxSize = 100) {
    this.createFn = createFn;
    this.resetFn = resetFn;
    this.maxSize = maxSize;
    this.pool = [];
    this.inUse = new Set();
  }

  acquire() {
    let obj;
    
    if (this.pool.length > 0) {
      obj = this.pool.pop();
    } else {
      obj = this.createFn();
    }
    
    this.inUse.add(obj);
    return obj;
  }

  release(obj) {
    if (!this.inUse.has(obj)) {
      return false;
    }
    
    this.inUse.delete(obj);
    
    if (this.pool.length < this.maxSize) {
      if (this.resetFn) {
        this.resetFn(obj);
      }
      this.pool.push(obj);
    }
    
    return true;
  }

  clear() {
    this.pool.length = 0;
    this.inUse.clear();
  }

  getStats() {
    return {
      poolSize: this.pool.length,
      inUse: this.inUse.size,
      maxSize: this.maxSize
    };
  }
}

/**
 * WeakMap-based cache with automatic cleanup
 */
class WeakCache {
  constructor() {
    this.cache = new WeakMap();
    this.keyRefs = new Map();
    this.maxSize = 1000;
  }

  set(key, value, ttl = 300000) { // 5 minutes default TTL
    // Store in WeakMap
    this.cache.set(key, {
      value,
      expires: Date.now() + ttl
    });

    // Keep a reference for cleanup
    this.keyRefs.set(key, {
      expires: Date.now() + ttl,
      cleanup: () => this.keyRefs.delete(key)
    });

    // Trigger cleanup if we have too many keys
    if (this.keyRefs.size > this.maxSize) {
      this.cleanup();
    }
  }

  get(key) {
    const cached = this.cache.get(key);
    
    if (!cached) {
      return null;
    }
    
    if (Date.now() > cached.expires) {
      this.delete(key);
      return null;
    }
    
    return cached.value;
  }

  delete(key) {
    this.keyRefs.delete(key);
    // WeakMap will clean up automatically
  }

  cleanup() {
    const now = Date.now();
    const expiredKeys = [];
    
    for (const [key, ref] of this.keyRefs.entries()) {
      if (now > ref.expires) {
        expiredKeys.push(key);
      }
    }
    
    expiredKeys.forEach(key => this.delete(key));
    
    console.log(`🧹 WeakCache cleanup: removed ${expiredKeys.length} expired entries`);
  }

  getStats() {
    return {
      activeKeys: this.keyRefs.size,
      maxSize: this.maxSize
    };
  }
}

/**
 * Request context for tracking resources per request
 */
class RequestContext {
  constructor(requestId) {
    this.requestId = requestId;
    this.startTime = performance.now();
    this.resources = new Set();
    this.timers = new Set();
    this.promises = new Set();
    this.abortController = new AbortController();
  }

  /**
   * Track a resource for cleanup
   */
  track(resource, cleanupFn) {
    const tracked = {
      resource,
      cleanup: cleanupFn || (() => {
        if (resource.close) resource.close();
        if (resource.destroy) resource.destroy();
        if (resource.end) resource.end();
      })
    };
    
    this.resources.add(tracked);
    return tracked;
  }

  /**
   * Track a timer
   */
  trackTimer(timerId) {
    this.timers.add(timerId);
    return () => {
      clearTimeout(timerId);
      this.timers.delete(timerId);
    };
  }

  /**
   * Track a promise
   */
  trackPromise(promise) {
    this.promises.add(promise);
    
    // Remove from tracking when resolved/rejected
    promise.finally(() => {
      this.promises.delete(promise);
    });
    
    return promise;
  }

  /**
   * Get abort signal for cancellable operations
   */
  getAbortSignal() {
    return this.abortController.signal;
  }

  /**
   * Clean up all tracked resources
   */
  cleanup() {
    const duration = performance.now() - this.startTime;
    
    // Abort any ongoing operations
    this.abortController.abort();
    
    // Clear timers
    this.timers.forEach(timerId => {
      clearTimeout(timerId);
    });
    this.timers.clear();
    
    // Cleanup resources
    this.resources.forEach(tracked => {
      try {
        tracked.cleanup();
      } catch (error) {
        console.warn(`Error cleaning up resource in request ${this.requestId}:`, error.message);
      }
    });
    this.resources.clear();
    
    console.log(`🧹 Request ${this.requestId} cleanup completed in ${duration.toFixed(2)}ms`);
  }

  /**
   * Get context statistics
   */
  getStats() {
    return {
      requestId: this.requestId,
      duration: performance.now() - this.startTime,
      resourceCount: this.resources.size,
      timerCount: this.timers.size,
      promiseCount: this.promises.size,
      isAborted: this.abortController.signal.aborted
    };
  }
}

/**
 * Memory-efficient data processor for large datasets
 */
class StreamProcessor {
  constructor(options = {}) {
    this.batchSize = options.batchSize || 1000;
    this.maxMemory = options.maxMemory || 100 * 1024 * 1024; // 100MB
    this.processingQueue = [];
    this.isProcessing = false;
  }

  /**
   * Process data in chunks to avoid memory spikes
   */
  async processLargeDataset(data, processor) {
    const chunks = this.chunkArray(data, this.batchSize);
    const results = [];
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      // Check memory usage before processing each chunk
      const memUsage = process.memoryUsage();
      if (memUsage.heapUsed > this.maxMemory) {
        console.warn('⚠️  High memory usage detected, triggering GC');
        if (global.gc) {
          global.gc();
        }
        
        // Wait a bit for GC to complete
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Process chunk
      try {
        const chunkResults = await this.processChunk(chunk, processor);
        results.push(...chunkResults);
      } catch (error) {
        console.error(`Error processing chunk ${i + 1}/${chunks.length}:`, error.message);
        throw error;
      }
      
      // Allow event loop to breathe
      if (i % 10 === 0) {
        await new Promise(resolve => setImmediate(resolve));
      }
    }
    
    return results;
  }

  /**
   * Process a single chunk
   */
  async processChunk(chunk, processor) {
    return new Promise((resolve, reject) => {
      setImmediate(async () => {
        try {
          const results = await Promise.all(chunk.map(processor));
          resolve(results);
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  /**
   * Split array into chunks
   */
  chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }
}

/**
 * Middleware factory for request context management
 */
export function createRequestContextMiddleware() {
  return (req, res, next) => {
    const requestId = req.headers['x-request-id'] || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const context = new RequestContext(requestId);
    
    // Attach context to request
    req.context = context;
    
    // Set response header
    res.setHeader('X-Request-ID', requestId);
    
    // Cleanup on response finish
    res.on('finish', () => {
      context.cleanup();
    });
    
    // Cleanup on connection close
    req.on('close', () => {
      context.cleanup();
    });
    
    next();
  };
}

// Singleton instances
const memoryOptimizer = new MemoryOptimizer();
const weakCache = new WeakCache();
const streamProcessor = new StreamProcessor();

// Set up event listeners
memoryOptimizer.on('memory:warning', (stats) => {
  console.warn(`⚠️  Memory usage warning: ${stats.heapUsagePercent}% (${stats.heapUsedMB}MB/${stats.heapTotalMB}MB)`);
});

memoryOptimizer.on('memory:critical', (stats) => {
  console.error(`🚨 Critical memory usage: ${stats.heapUsagePercent}% (${stats.heapUsedMB}MB/${stats.heapTotalMB}MB)`);
  
  // Force cleanup of weak cache
  weakCache.cleanup();
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, cleaning up memory resources...');
  memoryOptimizer.cleanup();
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, cleaning up memory resources...');
  memoryOptimizer.cleanup();
});

export {
  MemoryOptimizer,
  ObjectPool,
  WeakCache,
  RequestContext,
  StreamProcessor,
  createRequestContextMiddleware,
  memoryOptimizer,
  weakCache,
  streamProcessor
};

export default {
  MemoryOptimizer,
  ObjectPool,
  WeakCache,
  RequestContext,
  StreamProcessor,
  createRequestContextMiddleware,
  memoryOptimizer,
  weakCache,
  streamProcessor
};