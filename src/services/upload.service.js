import { 
  getUploadQueue, 
  createPriceListUploadProcessor, 
  UPLOAD_STATUS, 
  UPLOAD_PRIORITY 
} from '../utils/upload-queue.js';
import { getUploadLogger } from '../utils/upload-logger.js';
import { defaultConflictDetector } from '../utils/upload-conflict-detector.js';
import { parsePriceListFile, validatePriceListData, standardizePriceListData } from '../utils/file-parsers/index.js';
import { createPriceList, createPriceListItems } from '../db/price-list-queries.js';
import { getSupplierById } from '../db/supplier-queries.js';
import EventEmitter from 'events';

/**
 * Comprehensive upload service for price list management
 */
export class UploadService extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.queue = getUploadQueue({
      maxConcurrent: options.maxConcurrent || 5,
      retryAttempts: options.retryAttempts || 3,
      retryDelay: options.retryDelay || 1000,
      maxRetryDelay: options.maxRetryDelay || 30000
    });
    
    this.logger = getUploadLogger({
      logLevel: options.logLevel || 'info',
      enableConsole: options.enableConsole !== false,
      enableFile: options.enableFile !== false
    });
    
    this.conflictDetector = defaultConflictDetector;
    
    // Set up event forwarding from queue
    this.setupEventForwarding();
    
    // Performance monitoring
    this.startPerformanceMonitoring();
  }

  /**
   * Forward events from upload queue to service consumers
   */
  setupEventForwarding() {
    const eventsToForward = [
      'upload:queued',
      'upload:started', 
      'upload:progress',
      'upload:completed',
      'upload:failed',
      'upload:retry',
      'upload:cancelled',
      'upload:conflict',
      'upload:conflict_resolved'
    ];

    eventsToForward.forEach(event => {
      this.queue.on(event, (data) => {
        this.emit(event, data);
      });
    });
  }

  /**
   * Start performance monitoring
   */
  startPerformanceMonitoring() {
    setInterval(() => {
      const stats = this.queue.getStatistics();
      const health = this.queue.getHealthStatus();
      
      // Log performance metrics
      this.logger.logPerformanceMetric('queue_length', stats.queue.total);
      this.logger.logPerformanceMetric('processing_count', stats.processing.total);
      this.logger.logPerformanceMetric('success_rate', stats.performance.successRate);
      this.logger.logPerformanceMetric('average_processing_time', stats.performance.averageProcessingTime);
      
      // Emit health status if there are issues
      if (health.status !== 'healthy') {
        this.emit('health:warning', health);
      }
    }, 60000); // Every minute
  }

  /**
   * Upload a price list file
   */
  async uploadPriceList(uploadData) {
    const { file, supplierId, userId, priority = UPLOAD_PRIORITY.NORMAL, metadata = {} } = uploadData;
    
    try {
      // Validate basic parameters
      if (!file) {
        throw new Error('File is required');
      }
      
      if (!supplierId) {
        throw new Error('Supplier ID is required');
      }
      
      if (!userId) {
        throw new Error('User ID is required');
      }

      // Verify supplier exists and is active
      const supplier = await getSupplierById(supplierId);
      if (!supplier) {
        throw new Error('Supplier not found');
      }
      
      if (!supplier.isActive) {
        throw new Error('Supplier is inactive');
      }

      // Create upload processor
      const processor = createPriceListUploadProcessor(
        parsePriceListFile,
        validatePriceListData,
        createPriceList,
        createPriceListItems
      );

      // Prepare upload data for queue
      const queueData = {
        file,
        supplierId,
        userId,
        priority,
        metadata: {
          ...metadata,
          supplierName: supplier.companyName,
          uploadedAt: new Date().toISOString()
        },
        processor,
        timeout: this.calculateTimeout(file.size)
      };

      // Submit to queue (this handles conflict detection internally)
      const result = await this.queue.enqueue(queueData);
      
      await this.logger.logInfo('Price list upload submitted', {
        uploadId: result.uploadId,
        supplierId,
        fileName: file.originalname,
        fileSize: file.size,
        status: result.status
      });

      return result;
      
    } catch (error) {
      await this.logger.logError(null, 'upload_submission', error);
      throw error;
    }
  }

  /**
   * Get upload status with detailed information
   */
  getUploadStatus(uploadId) {
    const status = this.queue.getUploadStatus(uploadId);
    
    if (!status) {
      return null;
    }

    return {
      ...status,
      // Add computed fields for API response
      isActive: [UPLOAD_STATUS.QUEUED, UPLOAD_STATUS.PROCESSING, UPLOAD_STATUS.RETRYING].includes(status.status),
      isCompleted: [UPLOAD_STATUS.COMPLETED, UPLOAD_STATUS.FAILED, UPLOAD_STATUS.CANCELLED].includes(status.status),
      canCancel: [UPLOAD_STATUS.QUEUED, UPLOAD_STATUS.CONFLICT].includes(status.status),
      canRetry: status.status === UPLOAD_STATUS.FAILED && status.attempts < 3,
      progressPercent: Math.round(status.progress || 0),
      durationSeconds: status.duration ? Math.round(status.duration / 1000) : null
    };
  }

  /**
   * Cancel an upload
   */
  async cancelUpload(uploadId, reason = 'User cancelled', userId = null) {
    try {
      const result = await this.queue.cancelUpload(uploadId, reason);
      
      await this.logger.logInfo('Upload cancellation requested', {
        uploadId,
        reason,
        requestedBy: userId,
        result: result.success
      });

      return result;
    } catch (error) {
      await this.logger.logError(uploadId, 'cancel_upload', error);
      throw error;
    }
  }

  /**
   * Resolve upload conflict
   */
  async resolveConflict(uploadId, resolution, userId = null) {
    try {
      const result = await this.queue.resolveConflict(uploadId, {
        ...resolution,
        resolvedBy: userId,
        resolvedAt: new Date()
      });
      
      await this.logger.logInfo('Upload conflict resolved', {
        uploadId,
        resolution: resolution.action,
        resolvedBy: userId
      });

      return result;
    } catch (error) {
      await this.logger.logError(uploadId, 'resolve_conflict', error);
      throw error;
    }
  }

  /**
   * Get all uploads with filtering
   */
  getAllUploads(filters = {}) {
    const uploads = this.queue.getAllUploads(filters);
    
    // Add computed fields for each upload
    return uploads.map(upload => ({
      ...upload,
      isActive: [UPLOAD_STATUS.QUEUED, UPLOAD_STATUS.PROCESSING, UPLOAD_STATUS.RETRYING].includes(upload.status),
      isCompleted: [UPLOAD_STATUS.COMPLETED, UPLOAD_STATUS.FAILED, UPLOAD_STATUS.CANCELLED].includes(upload.status),
      canCancel: [UPLOAD_STATUS.QUEUED, UPLOAD_STATUS.CONFLICT].includes(upload.status),
      canRetry: upload.status === UPLOAD_STATUS.FAILED && upload.attempts < 3,
      progressPercent: Math.round(upload.progress || 0),
      durationSeconds: upload.duration ? Math.round(upload.duration / 1000) : null
    }));
  }

  /**
   * Get comprehensive statistics
   */
  getStatistics() {
    return this.queue.getStatistics();
  }

  /**
   * Get system health status
   */
  getHealthStatus() {
    return this.queue.getHealthStatus();
  }

  /**
   * Retry a failed upload
   */
  async retryUpload(uploadId, userId = null) {
    try {
      const upload = this.queue.getUploadStatus(uploadId);
      
      if (!upload) {
        throw new Error('Upload not found');
      }
      
      if (upload.status !== UPLOAD_STATUS.FAILED) {
        throw new Error('Only failed uploads can be retried');
      }

      // Reset upload for retry
      upload.status = UPLOAD_STATUS.QUEUED;
      upload.attempts = 0;
      upload.errors = [];
      upload.retryRequestedBy = userId;
      upload.retryRequestedAt = new Date();
      
      // Re-queue the upload
      this.queue.insertByPriority(upload);
      this.queue.processQueue();
      
      await this.logger.logInfo('Upload retry requested', {
        uploadId,
        requestedBy: userId
      });

      return { success: true, message: 'Upload queued for retry' };
      
    } catch (error) {
      await this.logger.logError(uploadId, 'retry_upload', error);
      throw error;
    }
  }

  /**
   * Bulk cancel uploads
   */
  async bulkCancelUploads(uploadIds, reason = 'Bulk cancellation', userId = null) {
    const results = [];
    
    for (const uploadId of uploadIds) {
      try {
        const result = await this.cancelUpload(uploadId, reason, userId);
        results.push({ uploadId, success: result.success, message: result.message });
      } catch (error) {
        results.push({ uploadId, success: false, error: error.message });
      }
    }
    
    await this.logger.logInfo('Bulk upload cancellation', {
      uploadIds,
      reason,
      requestedBy: userId,
      results: results.filter(r => r.success).length
    });

    return results;
  }

  /**
   * Update upload priority
   */
  async updateUploadPriority(uploadId, newPriority, userId = null) {
    try {
      const upload = this.queue.getUploadStatus(uploadId);
      
      if (!upload) {
        throw new Error('Upload not found');
      }
      
      if (upload.status !== UPLOAD_STATUS.QUEUED) {
        throw new Error('Can only update priority for queued uploads');
      }

      // Remove from current position
      const queueIndex = this.queue.queue.findIndex(u => u.id === uploadId);
      if (queueIndex !== -1) {
        const [queuedUpload] = this.queue.queue.splice(queueIndex, 1);
        queuedUpload.priority = newPriority;
        queuedUpload.priorityUpdatedBy = userId;
        queuedUpload.priorityUpdatedAt = new Date();
        
        // Re-insert with new priority
        this.queue.insertByPriority(queuedUpload);
      }
      
      await this.logger.logInfo('Upload priority updated', {
        uploadId,
        newPriority,
        updatedBy: userId
      });

      return { success: true, message: 'Priority updated successfully' };
      
    } catch (error) {
      await this.logger.logError(uploadId, 'update_priority', error);
      throw error;
    }
  }

  /**
   * Get upload logs
   */
  async getUploadLogs(uploadId, options = {}) {
    try {
      const logs = await this.logger.searchLogs(uploadId, {
        hours: options.hours || 24,
        limit: options.limit || 100
      });
      
      return logs;
    } catch (error) {
      await this.logger.logError(uploadId, 'get_logs', error);
      throw error;
    }
  }

  /**
   * Get system logs with filtering
   */
  async getSystemLogs(options = {}) {
    try {
      const stats = await this.logger.getLogStatistics(options.hours || 24);
      const recentErrors = await this.logger.searchLogs('error', {
        level: 'error',
        hours: options.hours || 24,
        limit: options.limit || 50
      });
      
      return {
        statistics: stats,
        recentErrors
      };
    } catch (error) {
      console.error('Failed to get system logs:', error);
      throw error;
    }
  }

  /**
   * Configure conflict detection
   */
  configureConflictDetection(config) {
    this.conflictDetector.updateRateLimits(config);
    
    if (config.maintenanceMode !== undefined) {
      this.conflictDetector.setMaintenanceMode(config.maintenanceMode);
    }
    
    this.logger.logInfo('Conflict detection configuration updated', config);
  }

  /**
   * Get conflict detection configuration
   */
  getConflictDetectionConfig() {
    return this.conflictDetector.getConfiguration();
  }

  /**
   * Calculate processing timeout based on file size
   */
  calculateTimeout(fileSize) {
    // Base timeout of 2 minutes + 1 minute per MB
    const baseMb = 1024 * 1024;
    const baseTimeout = 2 * 60 * 1000; // 2 minutes
    const additionalTime = Math.ceil(fileSize / baseMb) * 60 * 1000; // 1 minute per MB
    const maxTimeout = 30 * 60 * 1000; // 30 minutes max
    
    return Math.min(baseTimeout + additionalTime, maxTimeout);
  }

  /**
   * Pause the upload queue
   */
  pauseQueue() {
    this.queue.pauseQueue();
    this.logger.logInfo('Upload queue paused');
  }

  /**
   * Resume the upload queue
   */
  resumeQueue() {
    this.queue.resumeQueue();
    this.logger.logInfo('Upload queue resumed');
  }

  /**
   * Shutdown the service gracefully
   */
  async shutdown() {
    this.logger.logInfo('Upload service shutting down');
    
    // Stop accepting new uploads
    this.pauseQueue();
    
    // Wait for current uploads to complete (with timeout)
    const shutdownTimeout = 5 * 60 * 1000; // 5 minutes
    const startTime = Date.now();
    
    while (this.queue.processing.size > 0 && (Date.now() - startTime) < shutdownTimeout) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Cancel any remaining uploads
    const remainingUploads = Array.from(this.queue.processing.keys());
    if (remainingUploads.length > 0) {
      await this.bulkCancelUploads(remainingUploads, 'Service shutdown');
    }
    
    // Destroy the queue and flush logs
    this.queue.destroy();
    await this.logger.shutdown();
    
    this.removeAllListeners();
  }
}

// Singleton service instance
let uploadService = null;

/**
 * Get or create the upload service instance
 */
export function getUploadService(options) {
  if (!uploadService) {
    uploadService = new UploadService(options);
  }
  return uploadService;
}

/**
 * Create upload processor with validation and error handling
 */
export function createUploadProcessor() {
  return createPriceListUploadProcessor(
    parsePriceListFile,
    validatePriceListData,
    createPriceList,
    createPriceListItems
  );
}

export { UPLOAD_STATUS, UPLOAD_PRIORITY };