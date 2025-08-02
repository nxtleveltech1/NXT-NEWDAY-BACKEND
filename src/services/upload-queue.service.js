import { EventEmitter } from 'events';

/**
 * Upload Queue Service
 * Manages queuing and processing of upload operations with:
 * - Priority-based queue management
 * - Concurrent processing limits
 * - Retry mechanisms
 * - Progress tracking
 * - Error handling and recovery
 */

export const UPLOAD_STATUS = {
  QUEUED: 'queued',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  RETRYING: 'retrying'
};

export const UPLOAD_PRIORITY = {
  LOW: 1,
  NORMAL: 2,
  HIGH: 3,
  CRITICAL: 4
};

export class UploadQueue extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      maxConcurrent: options.maxConcurrent || 5,
      retryAttempts: options.retryAttempts || 3,
      retryDelay: options.retryDelay || 1000,
      maxRetryDelay: options.maxRetryDelay || 30000,
      processTimeout: options.processTimeout || 300000, // 5 minutes
      ...options
    };
    
    this.queue = [];
    this.processing = new Map();
    this.completed = new Map();
    this.failed = new Map();
    
    this.stats = {
      totalQueued: 0,
      totalProcessed: 0,
      totalCompleted: 0,
      totalFailed: 0,
      averageProcessingTime: 0
    };
    
    this.isProcessing = false;
    
    // Start processing
    this.startProcessing();
  }

  /**
   * Add upload to queue
   */
  async addUpload(uploadData, options = {}) {
    const uploadId = uploadData.uploadId || this.generateUploadId();
    
    const queueItem = {
      uploadId,
      data: uploadData,
      priority: options.priority || UPLOAD_PRIORITY.NORMAL,
      attempts: 0,
      maxAttempts: options.maxAttempts || this.options.retryAttempts,
      addedAt: new Date(),
      status: UPLOAD_STATUS.QUEUED,
      ...options
    };
    
    // Insert based on priority
    this.insertByPriority(queueItem);
    
    this.stats.totalQueued++;
    
    this.emit('upload:queued', {
      uploadId,
      priority: queueItem.priority,
      queueLength: this.queue.length
    });
    
    return uploadId;
  }

  /**
   * Insert item into queue based on priority
   */
  insertByPriority(item) {
    let insertIndex = this.queue.length;
    
    for (let i = 0; i < this.queue.length; i++) {
      if (this.queue[i].priority < item.priority) {
        insertIndex = i;
        break;
      }
    }
    
    this.queue.splice(insertIndex, 0, item);
  }

  /**
   * Start processing queue
   */
  startProcessing() {
    if (this.isProcessing) return;
    
    this.isProcessing = true;
    this.processNext();
  }

  /**
   * Stop processing queue
   */
  stopProcessing() {
    this.isProcessing = false;
  }

  /**
   * Process next item in queue
   */
  async processNext() {
    if (!this.isProcessing) return;
    
    // Check if we have capacity
    if (this.processing.size >= this.options.maxConcurrent) {
      setTimeout(() => this.processNext(), 100);
      return;
    }
    
    // Get next item from queue
    const item = this.queue.shift();
    
    if (!item) {
      setTimeout(() => this.processNext(), 1000);
      return;
    }
    
    // Process the item
    this.processItem(item);
    
    // Continue processing
    setImmediate(() => this.processNext());
  }

  /**
   * Process individual upload item
   */
  async processItem(item) {
    const { uploadId } = item;
    
    try {
      // Mark as processing
      item.status = UPLOAD_STATUS.PROCESSING;
      item.startedAt = new Date();
      this.processing.set(uploadId, item);
      
      this.emit('upload:started', {
        uploadId,
        attempts: item.attempts + 1,
        maxAttempts: item.maxAttempts
      });
      
      // Create processor instance
      const processor = this.createProcessor(item.data.type || 'default');
      
      // Process with timeout
      const result = await Promise.race([
        processor.process(item.data),
        this.createTimeout(uploadId)
      ]);
      
      // Mark as completed
      await this.completeUpload(uploadId, result);
      
    } catch (error) {
      await this.handleUploadError(uploadId, error);
    }
  }

  /**
   * Create processor for upload type
   */
  createProcessor(type) {
    // Return a basic processor - in real implementation, this would create
    // specialized processors based on upload type
    return {
      process: async (data) => {
        // Simulate processing
        await new Promise(resolve => setTimeout(resolve, Math.random() * 1000));
        
        return {
          success: true,
          uploadId: data.uploadId,
          result: 'Processing completed successfully',
          itemsProcessed: Math.floor(Math.random() * 100) + 1
        };
      }
    };
  }

  /**
   * Create timeout promise
   */
  createTimeout(uploadId) {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Upload ${uploadId} timed out after ${this.options.processTimeout}ms`));
      }, this.options.processTimeout);
    });
  }

  /**
   * Complete upload successfully
   */
  async completeUpload(uploadId, result) {
    const item = this.processing.get(uploadId);
    if (!item) return;
    
    item.status = UPLOAD_STATUS.COMPLETED;
    item.completedAt = new Date();
    item.result = result;
    item.processingTime = item.completedAt - item.startedAt;
    
    // Move to completed
    this.processing.delete(uploadId);
    this.completed.set(uploadId, item);
    
    // Update stats
    this.stats.totalProcessed++;
    this.stats.totalCompleted++;
    this.updateAverageProcessingTime(item.processingTime);
    
    this.emit('upload:completed', {
      uploadId,
      result,
      processingTime: item.processingTime,
      attempts: item.attempts + 1
    });
  }

  /**
   * Handle upload error
   */
  async handleUploadError(uploadId, error) {
    const item = this.processing.get(uploadId);
    if (!item) return;
    
    item.attempts++;
    item.lastError = error.message;
    item.lastErrorAt = new Date();
    
    // Check if we should retry
    if (item.attempts < item.maxAttempts) {
      item.status = UPLOAD_STATUS.RETRYING;
      
      // Calculate retry delay with exponential backoff
      const delay = Math.min(
        this.options.retryDelay * Math.pow(2, item.attempts - 1),
        this.options.maxRetryDelay
      );
      
      this.emit('upload:retry', {
        uploadId,
        attempt: item.attempts,
        maxAttempts: item.maxAttempts,
        delay,
        error: error.message
      });
      
      // Re-queue after delay
      setTimeout(() => {
        this.processing.delete(uploadId);
        this.insertByPriority(item);
      }, delay);
      
    } else {
      // Mark as failed
      item.status = UPLOAD_STATUS.FAILED;
      item.failedAt = new Date();
      
      this.processing.delete(uploadId);
      this.failed.set(uploadId, item);
      
      this.stats.totalProcessed++;
      this.stats.totalFailed++;
      
      this.emit('upload:failed', {
        uploadId,
        error: error.message,
        attempts: item.attempts,
        finalError: true
      });
    }
  }

  /**
   * Cancel upload
   */
  async cancelUpload(uploadId, reason = 'Cancelled by user') {
    // Check if in queue
    const queueIndex = this.queue.findIndex(item => item.uploadId === uploadId);
    if (queueIndex !== -1) {
      const item = this.queue.splice(queueIndex, 1)[0];
      item.status = UPLOAD_STATUS.CANCELLED;
      item.cancelledAt = new Date();
      item.cancelReason = reason;
      
      this.emit('upload:cancelled', { uploadId, reason });
      return true;
    }
    
    // Check if processing
    const processingItem = this.processing.get(uploadId);
    if (processingItem) {
      processingItem.status = UPLOAD_STATUS.CANCELLED;
      processingItem.cancelledAt = new Date();
      processingItem.cancelReason = reason;
      
      this.processing.delete(uploadId);
      
      this.emit('upload:cancelled', { uploadId, reason });
      return true;
    }
    
    return false; // Upload not found or already completed
  }

  /**
   * Get upload status
   */
  getUploadStatus(uploadId) {
    // Check processing
    if (this.processing.has(uploadId)) {
      const item = this.processing.get(uploadId);
      return {
        uploadId,
        status: item.status,
        attempts: item.attempts,
        startedAt: item.startedAt,
        progress: this.calculateProgress(item)
      };
    }
    
    // Check completed
    if (this.completed.has(uploadId)) {
      const item = this.completed.get(uploadId);
      return {
        uploadId,
        status: item.status,
        completedAt: item.completedAt,
        processingTime: item.processingTime,
        result: item.result
      };
    }
    
    // Check failed
    if (this.failed.has(uploadId)) {
      const item = this.failed.get(uploadId);
      return {
        uploadId,
        status: item.status,
        failedAt: item.failedAt,
        attempts: item.attempts,
        error: item.lastError
      };
    }
    
    // Check queue
    const queueItem = this.queue.find(item => item.uploadId === uploadId);
    if (queueItem) {
      return {
        uploadId,
        status: queueItem.status,
        queuePosition: this.queue.indexOf(queueItem) + 1,
        addedAt: queueItem.addedAt
      };
    }
    
    return null; // Upload not found
  }

  /**
   * Calculate progress for processing item
   */
  calculateProgress(item) {
    if (!item.startedAt) return 0;
    
    const elapsed = Date.now() - item.startedAt.getTime();
    const estimated = this.stats.averageProcessingTime || 60000; // Default 1 minute
    
    return Math.min(Math.round((elapsed / estimated) * 100), 95); // Cap at 95% until complete
  }

  /**
   * Update average processing time
   */
  updateAverageProcessingTime(newTime) {
    if (this.stats.totalCompleted === 1) {
      this.stats.averageProcessingTime = newTime;
    } else {
      this.stats.averageProcessingTime = 
        (this.stats.averageProcessingTime * (this.stats.totalCompleted - 1) + newTime) / this.stats.totalCompleted;
    }
  }

  /**
   * Generate unique upload ID
   */
  generateUploadId() {
    return `upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get queue statistics
   */
  getStats() {
    return {
      ...this.stats,
      queueLength: this.queue.length,
      processing: this.processing.size,
      completed: this.completed.size,
      failed: this.failed.size,
      successRate: this.stats.totalProcessed > 0 
        ? ((this.stats.totalCompleted / this.stats.totalProcessed) * 100).toFixed(2)
        : 0
    };
  }

  /**
   * Clear completed and failed uploads
   */
  clearHistory(olderThan = 24 * 60 * 60 * 1000) { // 24 hours default
    const cutoff = Date.now() - olderThan;
    
    let cleared = 0;
    
    // Clear completed
    for (const [uploadId, item] of this.completed.entries()) {
      if (item.completedAt && item.completedAt.getTime() < cutoff) {
        this.completed.delete(uploadId);
        cleared++;
      }
    }
    
    // Clear failed
    for (const [uploadId, item] of this.failed.entries()) {
      if (item.failedAt && item.failedAt.getTime() < cutoff) {
        this.failed.delete(uploadId);
        cleared++;
      }
    }
    
    return cleared;
  }
}

// Singleton instance
let queueInstance = null;

export function getUploadQueue(options = {}) {
  if (!queueInstance) {
    queueInstance = new UploadQueue(options);
  }
  return queueInstance;
}

// Create processor factory
export function createPriceListUploadProcessor(options = {}) {
  return {
    process: async (data) => {
      // This would contain the actual price list processing logic
      // For now, return a mock result
      return {
        success: true,
        uploadId: data.uploadId,
        itemsProcessed: data.itemCount || 0,
        processingTime: Date.now() - (data.startTime || Date.now())
      };
    }
  };
}

export default UploadQueue;