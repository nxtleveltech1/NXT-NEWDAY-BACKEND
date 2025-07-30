import EventEmitter from 'events';
import { createUploadHistoryRecord, updateUploadHistoryStatus } from '../db/upload-history-queries.js';
import { UploadLogger } from './upload-logger.js';
import { ConflictDetector } from './upload-conflict-detector.js';

// Upload status enum
export const UPLOAD_STATUS = {
  QUEUED: 'queued',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  CONFLICT: 'conflict',
  RETRYING: 'retrying'
};

// Upload priority enum
export const UPLOAD_PRIORITY = {
  LOW: 1,
  NORMAL: 2,
  HIGH: 3,
  URGENT: 4,
  CRITICAL: 5
};

// Upload queue manager with enhanced capabilities
export class UploadQueue extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.maxConcurrent = options.maxConcurrent || 5;
    this.queue = [];
    this.processing = new Map();
    this.completed = new Map();
    this.conflicts = new Map();
    this.retryAttempts = options.retryAttempts || 3;
    this.retryDelay = options.retryDelay || 1000;
    this.maxRetryDelay = options.maxRetryDelay || 30000;
    
    // Initialize components
    this.logger = new UploadLogger();
    this.conflictDetector = new ConflictDetector();
    
    // Performance metrics
    this.metrics = {
      totalProcessed: 0,
      totalSuccessful: 0,
      totalFailed: 0,
      totalConflicts: 0,
      averageProcessingTime: 0,
      throughput: 0
    };
    
    // Cleanup old completed uploads after 1 hour
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldUploads();
    }, 60 * 60 * 1000);
    
    // Metrics update interval
    this.metricsInterval = setInterval(() => {
      this.updateMetrics();
    }, 30 * 1000);
  }
  
  // Add upload to queue with enhanced priority and conflict checking
  async enqueue(uploadData) {
    const uploadId = this.generateUploadId();
    
    const upload = {
      id: uploadId,
      ...uploadData,
      status: UPLOAD_STATUS.QUEUED,
      priority: uploadData.priority || UPLOAD_PRIORITY.NORMAL,
      createdAt: new Date(),
      queuedAt: new Date(),
      attempts: 0,
      errors: [],
      warnings: [],
      progress: 0,
      estimatedDuration: null,
      metadata: uploadData.metadata || {}
    };

    try {
      // Check for conflicts before queuing
      const conflictCheck = await this.conflictDetector.checkForConflicts(upload);
      
      if (conflictCheck.hasConflict) {
        upload.status = UPLOAD_STATUS.CONFLICT;
        upload.conflictDetails = conflictCheck.details;
        this.conflicts.set(uploadId, upload);
        
        await this.logger.logConflict(upload, conflictCheck);
        this.emit('upload:conflict', upload);
        
        return {
          uploadId,
          status: 'conflict',
          conflicts: conflictCheck.details,
          resolution: conflictCheck.suggestedResolution
        };
      }

      // Create upload history record
      const historyRecord = await createUploadHistoryRecord({
        supplierId: upload.supplierId,
        fileName: upload.file.originalname,
        fileType: upload.fileType || this.detectFileType(upload.file),
        fileSize: upload.file.size,
        status: 'processing',
        uploadedBy: upload.userId
      });
      
      upload.historyId = historyRecord.id;

      // Insert into queue with priority ordering
      this.insertByPriority(upload);
      
      await this.logger.logUploadQueued(upload);
      this.emit('upload:queued', upload);
      
      // Process queue
      setImmediate(() => this.processQueue());
      
      return {
        uploadId,
        status: 'queued',
        position: this.getQueuePosition(uploadId),
        estimatedWait: this.estimateWaitTime(upload.priority)
      };
      
    } catch (error) {
      await this.logger.logError(uploadId, 'queue_error', error);
      throw new Error(`Failed to queue upload: ${error.message}`);
    }
  }

  // Insert upload into queue based on priority
  insertByPriority(upload) {
    let insertIndex = this.queue.length;
    
    // Find the correct position based on priority and creation time
    for (let i = 0; i < this.queue.length; i++) {
      const queuedUpload = this.queue[i];
      
      // Higher priority goes first
      if (upload.priority > queuedUpload.priority) {
        insertIndex = i;
        break;
      }
      
      // Same priority: FIFO (First In, First Out)
      if (upload.priority === queuedUpload.priority && 
          upload.createdAt < queuedUpload.createdAt) {
        insertIndex = i;
        break;
      }
    }
    
    this.queue.splice(insertIndex, 0, upload);
  }

  // Get position of upload in queue
  getQueuePosition(uploadId) {
    return this.queue.findIndex(upload => upload.id === uploadId) + 1;
  }

  // Estimate wait time based on priority and queue
  estimateWaitTime(priority) {
    const priorityUploads = this.queue.filter(u => u.priority >= priority);
    const avgProcessingTime = this.metrics.averageProcessingTime || 60000; // 1 minute default
    const availableSlots = Math.max(1, this.maxConcurrent - this.processing.size);
    
    return Math.ceil((priorityUploads.length / availableSlots) * avgProcessingTime);
  }
  
  // Process queued uploads
  async processQueue() {
    // Check if queue is paused
    if (this.paused) {
      return;
    }
    
    while (this.processing.size < this.maxConcurrent && this.queue.length > 0) {
      const upload = this.queue.shift();
      this.processUpload(upload);
    }
  }
  
  // Process individual upload with comprehensive error handling
  async processUpload(upload) {
    upload.status = UPLOAD_STATUS.PROCESSING;
    upload.startedAt = new Date();
    this.processing.set(upload.id, upload);
    
    await this.logger.logUploadStarted(upload);
    this.emit('upload:started', upload);
    
    try {
      // Enhanced progress tracking
      const updateProgress = (progress, details = {}) => {
        upload.progress = Math.min(100, Math.max(0, progress));
        upload.progressDetails = details;
        upload.lastProgressUpdate = new Date();
        
        this.emit('upload:progress', { 
          uploadId: upload.id, 
          progress: upload.progress,
          details,
          estimatedTimeRemaining: this.calculateTimeRemaining(upload)
        });
      };

      // Validate upload before processing
      const validationResult = await this.validateUpload(upload);
      if (!validationResult.valid) {
        throw new Error(`Upload validation failed: ${validationResult.errors.join(', ')}`);
      }

      updateProgress(5, { stage: 'validation', message: 'Upload validated successfully' });

      // Execute the upload processor with timeout
      const processingTimeout = upload.timeout || 300000; // 5 minutes default
      const result = await Promise.race([
        upload.processor(upload.data, updateProgress),
        this.createTimeoutPromise(processingTimeout, upload.id)
      ]);
      
      // Mark as completed
      upload.status = UPLOAD_STATUS.COMPLETED;
      upload.completedAt = new Date();
      upload.duration = upload.completedAt - upload.startedAt;
      upload.result = result;
      
      // Update database record
      if (upload.historyId) {
        await updateUploadHistoryStatus(upload.historyId, 'completed', {
          itemCount: result.itemCount || 0,
          successCount: result.itemCount || 0,
          metadata: { result, duration: upload.duration }
        });
      }
      
      this.processing.delete(upload.id);
      this.completed.set(upload.id, upload);
      
      await this.logger.logUploadCompleted(upload);
      this.emit('upload:completed', upload);
      
      // Update metrics
      this.metrics.totalSuccessful++;
      
    } catch (error) {
      await this.handleUploadError(upload, error);
    }
    
    // Process next in queue
    setImmediate(() => this.processQueue());
  }

  // Handle upload errors with retry logic
  async handleUploadError(upload, error) {
    upload.attempts++;
    const errorInfo = {
      attempt: upload.attempts,
      error: error.message,
      stack: error.stack,
      timestamp: new Date(),
      type: this.categorizeError(error)
    };
    
    upload.errors.push(errorInfo);
    
    await this.logger.logUploadError(upload, error);
    
    // Check if error is retryable
    const isRetryable = this.isRetryableError(error);
    const hasRetriesLeft = upload.attempts < this.retryAttempts;
    
    if (isRetryable && hasRetriesLeft) {
      // Calculate retry delay with exponential backoff
      const baseDelay = this.retryDelay * Math.pow(2, upload.attempts - 1);
      const jitter = Math.random() * 1000; // Add jitter to prevent thundering herd
      const retryDelay = Math.min(baseDelay + jitter, this.maxRetryDelay);
      
      upload.status = UPLOAD_STATUS.RETRYING;
      upload.nextRetryAt = new Date(Date.now() + retryDelay);
      
      this.processing.delete(upload.id);
      
      setTimeout(() => {
        if (upload.status === UPLOAD_STATUS.RETRYING) { // Check if not cancelled
          upload.status = UPLOAD_STATUS.QUEUED;
          this.insertByPriority(upload);
          this.processQueue();
        }
      }, retryDelay);
      
      this.emit('upload:retry', { upload, retryDelay, nextRetryAt: upload.nextRetryAt });
      
    } else {
      // Mark as permanently failed
      upload.status = UPLOAD_STATUS.FAILED;
      upload.failedAt = new Date();
      upload.duration = upload.failedAt - upload.startedAt;
      upload.finalError = errorInfo;
      
      // Update database record
      if (upload.historyId) {
        await updateUploadHistoryStatus(upload.historyId, 'failed', {
          errorCount: upload.errors.length,
          errors: upload.errors,
          metadata: { finalError: errorInfo, duration: upload.duration }
        });
      }
      
      this.processing.delete(upload.id);
      this.completed.set(upload.id, upload);
      
      await this.logger.logUploadFailed(upload);
      this.emit('upload:failed', upload);
      
      // Update metrics
      this.metrics.totalFailed++;
    }
  }

  // Create timeout promise
  createTimeoutPromise(timeout, uploadId) {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Upload ${uploadId} timed out after ${timeout}ms`));
      }, timeout);
    });
  }

  // Calculate estimated time remaining
  calculateTimeRemaining(upload) {
    if (!upload.startedAt || !upload.progress || upload.progress === 0) {
      return null;
    }
    
    const elapsed = Date.now() - upload.startedAt.getTime();
    const rate = upload.progress / elapsed;
    const remaining = (100 - upload.progress) / rate;
    
    return Math.max(0, remaining);
  }

  // Validate upload before processing
  async validateUpload(upload) {
    const errors = [];
    
    // Check required fields
    if (!upload.file) errors.push('File is required');
    if (!upload.supplierId) errors.push('Supplier ID is required');
    if (!upload.userId) errors.push('User ID is required');
    if (!upload.processor) errors.push('Processor function is required');
    
    // Check file size limits
    const maxFileSize = 50 * 1024 * 1024; // 50MB
    if (upload.file && upload.file.size > maxFileSize) {
      errors.push(`File size exceeds maximum limit of ${maxFileSize} bytes`);
    }
    
    // Check if supplier exists and is active
    // This would typically call a service to validate supplier
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  // Categorize error types
  categorizeError(error) {
    const message = error.message.toLowerCase();
    
    if (message.includes('timeout')) return 'timeout';
    if (message.includes('network') || message.includes('connection')) return 'network';
    if (message.includes('validation') || message.includes('invalid')) return 'validation';
    if (message.includes('permission') || message.includes('unauthorized')) return 'permission';
    if (message.includes('file') || message.includes('parse')) return 'file_processing';
    if (message.includes('database') || message.includes('sql')) return 'database';
    
    return 'unknown';
  }

  // Check if error is retryable
  isRetryableError(error) {
    const errorType = this.categorizeError(error);
    const retryableTypes = ['timeout', 'network', 'database'];
    
    // Don't retry validation, permission, or file processing errors
    return retryableTypes.includes(errorType);
  }
  
  // Get upload status with enhanced details
  getUploadStatus(uploadId) {
    // Check conflicts first
    if (this.conflicts.has(uploadId)) {
      const upload = this.conflicts.get(uploadId);
      return {
        ...upload,
        position: null,
        estimatedWait: null
      };
    }
    
    // Check processing
    if (this.processing.has(uploadId)) {
      const upload = this.processing.get(uploadId);
      return {
        ...upload,
        position: null,
        estimatedWait: this.calculateTimeRemaining(upload)
      };
    }
    
    // Check completed
    if (this.completed.has(uploadId)) {
      const upload = this.completed.get(uploadId);
      return {
        ...upload,
        position: null,
        estimatedWait: null
      };
    }
    
    // Check queue
    const queuedIndex = this.queue.findIndex(u => u.id === uploadId);
    if (queuedIndex !== -1) {
      const upload = this.queue[queuedIndex];
      return {
        ...upload,
        position: queuedIndex + 1,
        estimatedWait: this.estimateWaitTime(upload.priority)
      };
    }
    
    return null;
  }
  
  // Cancel upload with enhanced handling
  async cancelUpload(uploadId, reason = 'User cancelled') {
    // Check conflicts
    if (this.conflicts.has(uploadId)) {
      const upload = this.conflicts.get(uploadId);
      upload.status = UPLOAD_STATUS.CANCELLED;
      upload.cancelledAt = new Date();
      upload.cancellationReason = reason;
      
      this.conflicts.delete(uploadId);
      this.completed.set(uploadId, upload);
      
      await this.logger.logUploadCancelled(upload, reason);
      this.emit('upload:cancelled', upload);
      return { success: true, message: 'Upload cancelled successfully' };
    }
    
    // Remove from queue
    const queueIndex = this.queue.findIndex(u => u.id === uploadId);
    if (queueIndex !== -1) {
      const upload = this.queue.splice(queueIndex, 1)[0];
      upload.status = UPLOAD_STATUS.CANCELLED;
      upload.cancelledAt = new Date();
      upload.cancellationReason = reason;
      
      // Update database record
      if (upload.historyId) {
        await updateUploadHistoryStatus(upload.historyId, 'failed', {
          metadata: { cancelled: true, reason }
        });
      }
      
      this.completed.set(uploadId, upload);
      
      await this.logger.logUploadCancelled(upload, reason);
      this.emit('upload:cancelled', upload);
      return { success: true, message: 'Upload removed from queue' };
    }
    
    // Check if currently processing (mark for cancellation)
    if (this.processing.has(uploadId)) {
      const upload = this.processing.get(uploadId);
      upload.cancellationRequested = true;
      upload.cancellationReason = reason;
      
      // The actual cancellation will be handled by the processor
      this.emit('upload:cancellation_requested', upload);
      return { 
        success: false, 
        message: 'Upload is currently processing. Cancellation requested.',
        pending: true
      };
    }
    
    // Check if already completed
    if (this.completed.has(uploadId)) {
      return { success: false, message: 'Upload already completed' };
    }
    
    return { success: false, message: 'Upload not found' };
  }

  // Resolve upload conflict
  async resolveConflict(uploadId, resolution) {
    if (!this.conflicts.has(uploadId)) {
      throw new Error('No conflict found for upload');
    }
    
    const upload = this.conflicts.get(uploadId);
    upload.resolution = resolution;
    
    switch (resolution.action) {
      case 'proceed':
        // Move to queue with updated parameters
        upload.status = UPLOAD_STATUS.QUEUED;
        if (resolution.priority) upload.priority = resolution.priority;
        
        this.conflicts.delete(uploadId);
        this.insertByPriority(upload);
        
        await this.logger.logConflictResolved(upload, resolution);
        this.emit('upload:conflict_resolved', upload);
        this.processQueue();
        break;
        
      case 'cancel':
        return await this.cancelUpload(uploadId, 'Conflict resolution: cancelled');
        
      case 'replace':
        // Mark existing upload for replacement
        upload.replacement = true;
        upload.status = UPLOAD_STATUS.QUEUED;
        
        this.conflicts.delete(uploadId);
        this.insertByPriority(upload);
        
        await this.logger.logConflictResolved(upload, resolution);
        this.emit('upload:conflict_resolved', upload);
        this.processQueue();
        break;
        
      default:
        throw new Error(`Unknown resolution action: ${resolution.action}`);
    }
    
    return { success: true, message: 'Conflict resolved successfully' };
  }
  
  // Get comprehensive queue statistics
  getStatistics() {
    const stats = {
      queue: {
        total: this.queue.length,
        byPriority: {},
        bySupplier: {},
        avgWaitTime: 0
      },
      processing: {
        total: this.processing.size,
        byStatus: {},
        avgProgress: 0
      },
      completed: {
        total: this.completed.size,
        successful: 0,
        failed: 0,
        cancelled: 0,
        withConflicts: 0
      },
      conflicts: {
        total: this.conflicts.size,
        unresolved: 0
      },
      performance: {
        ...this.metrics,
        successRate: this.metrics.totalProcessed > 0 ? 
          (this.metrics.totalSuccessful / this.metrics.totalProcessed * 100).toFixed(2) : 0,
        failureRate: this.metrics.totalProcessed > 0 ? 
          (this.metrics.totalFailed / this.metrics.totalProcessed * 100).toFixed(2) : 0
      }
    };
    
    // Calculate queue statistics
    this.queue.forEach(upload => {
      stats.queue.byPriority[upload.priority] = (stats.queue.byPriority[upload.priority] || 0) + 1;
      stats.queue.bySupplier[upload.supplierId] = (stats.queue.bySupplier[upload.supplierId] || 0) + 1;
    });
    
    // Calculate processing statistics
    let totalProgress = 0;
    this.processing.forEach(upload => {
      stats.processing.byStatus[upload.status] = (stats.processing.byStatus[upload.status] || 0) + 1;
      totalProgress += upload.progress || 0;
    });
    stats.processing.avgProgress = this.processing.size > 0 ? 
      (totalProgress / this.processing.size).toFixed(1) : 0;
    
    // Calculate completed statistics
    this.completed.forEach(upload => {
      switch (upload.status) {
        case UPLOAD_STATUS.COMPLETED:
          stats.completed.successful++;
          break;
        case UPLOAD_STATUS.FAILED:
          stats.completed.failed++;
          break;
        case UPLOAD_STATUS.CANCELLED:
          stats.completed.cancelled++;
          break;
      }
      
      if (upload.conflictDetails) {
        stats.completed.withConflicts++;
      }
    });
    
    // Calculate unresolved conflicts
    this.conflicts.forEach(upload => {
      if (!upload.resolution) {
        stats.conflicts.unresolved++;
      }
    });
    
    return stats;
  }
  
  // Get all uploads with enhanced filtering
  getAllUploads(filters = {}) {
    const all = [
      ...this.queue,
      ...Array.from(this.processing.values()),
      ...Array.from(this.completed.values()),
      ...Array.from(this.conflicts.values())
    ];
    
    let filtered = all;
    
    // Apply filters
    if (filters.status) {
      filtered = filtered.filter(upload => upload.status === filters.status);
    }
    
    if (filters.supplierId) {
      filtered = filtered.filter(upload => upload.supplierId === filters.supplierId);
    }
    
    if (filters.userId) {
      filtered = filtered.filter(upload => upload.userId === filters.userId);
    }
    
    if (filters.priority) {
      filtered = filtered.filter(upload => upload.priority === filters.priority);
    }
    
    if (filters.dateFrom) {
      const dateFrom = new Date(filters.dateFrom);
      filtered = filtered.filter(upload => upload.createdAt >= dateFrom);
    }
    
    if (filters.dateTo) {
      const dateTo = new Date(filters.dateTo);
      filtered = filtered.filter(upload => upload.createdAt <= dateTo);
    }
    
    // Sort by creation date (newest first) or custom sort
    const sortBy = filters.sortBy || 'createdAt';
    const sortOrder = filters.sortOrder || 'desc';
    
    filtered.sort((a, b) => {
      const valueA = a[sortBy];
      const valueB = b[sortBy];
      
      if (sortOrder === 'asc') {
        return valueA > valueB ? 1 : valueA < valueB ? -1 : 0;
      } else {
        return valueA < valueB ? 1 : valueA > valueB ? -1 : 0;
      }
    });
    
    return filtered;
  }
  
  // Cleanup old completed uploads with enhanced logic
  cleanupOldUploads() {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    let cleanedCount = 0;
    
    // Clean up successful uploads older than 1 hour
    for (const [id, upload] of this.completed.entries()) {
      if (upload.status === UPLOAD_STATUS.COMPLETED && 
          upload.completedAt && upload.completedAt < oneHourAgo) {
        this.completed.delete(id);
        cleanedCount++;
      }
    }
    
    // Clean up failed/cancelled uploads older than 1 day
    for (const [id, upload] of this.completed.entries()) {
      if ((upload.status === UPLOAD_STATUS.FAILED || upload.status === UPLOAD_STATUS.CANCELLED) &&
          (upload.failedAt || upload.cancelledAt) && 
          (upload.failedAt || upload.cancelledAt) < oneDayAgo) {
        this.completed.delete(id);
        cleanedCount++;
      }
    }
    
    // Clean up resolved conflicts older than 1 hour
    for (const [id, upload] of this.conflicts.entries()) {
      if (upload.resolution && upload.resolvedAt && upload.resolvedAt < oneHourAgo) {
        this.conflicts.delete(id);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      this.logger.logInfo(`Cleaned up ${cleanedCount} old upload records`);
    }
  }

  // Update performance metrics
  updateMetrics() {
    this.metrics.totalProcessed = this.metrics.totalSuccessful + this.metrics.totalFailed;
    
    // Calculate average processing time
    const completedUploads = Array.from(this.completed.values())
      .filter(upload => upload.duration && upload.status === UPLOAD_STATUS.COMPLETED);
    
    if (completedUploads.length > 0) {
      const totalTime = completedUploads.reduce((sum, upload) => sum + upload.duration, 0);
      this.metrics.averageProcessingTime = totalTime / completedUploads.length;
    }
    
    // Calculate throughput (uploads per minute)
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const recentCompletions = Array.from(this.completed.values())
      .filter(upload => upload.completedAt && upload.completedAt.getTime() > oneMinuteAgo);
    
    this.metrics.throughput = recentCompletions.length;
  }

  // Detect file type helper
  detectFileType(file) {
    if (!file || !file.originalname) return 'unknown';
    
    const extension = file.originalname.toLowerCase().split('.').pop();
    const mimeType = file.mimetype;
    
    if (extension === 'csv' || mimeType === 'text/csv') return 'CSV';
    if (['xlsx', 'xls'].includes(extension) || mimeType.includes('spreadsheet')) return 'EXCEL';
    if (extension === 'json' || mimeType === 'application/json') return 'JSON';
    if (extension === 'xml' || mimeType.includes('xml')) return 'XML';
    if (extension === 'pdf' || mimeType === 'application/pdf') return 'PDF';
    
    return 'unknown';
  }

  // Get upload health status
  getHealthStatus() {
    const stats = this.getStatistics();
    const issues = [];
    const warnings = [];
    
    // Check queue length
    if (stats.queue.total > 50) {
      issues.push('Queue is very long (>50 uploads)');
    } else if (stats.queue.total > 20) {
      warnings.push('Queue is getting long (>20 uploads)');
    }
    
    // Check processing time
    if (this.metrics.averageProcessingTime > 300000) { // 5 minutes
      warnings.push('Average processing time is high (>5 minutes)');
    }
    
    // Check failure rate
    const failureRate = parseFloat(stats.performance.failureRate);
    if (failureRate > 20) {
      issues.push(`High failure rate: ${failureRate}%`);
    } else if (failureRate > 10) {
      warnings.push(`Elevated failure rate: ${failureRate}%`);
    }
    
    // Check unresolved conflicts
    if (stats.conflicts.unresolved > 5) {
      issues.push(`Too many unresolved conflicts: ${stats.conflicts.unresolved}`);
    } else if (stats.conflicts.unresolved > 2) {
      warnings.push(`Some unresolved conflicts: ${stats.conflicts.unresolved}`);
    }
    
    return {
      status: issues.length > 0 ? 'unhealthy' : warnings.length > 0 ? 'warning' : 'healthy',
      issues,
      warnings,
      timestamp: new Date()
    };
  }

  // Pause/resume queue processing
  pauseQueue() {
    this.paused = true;
    this.emit('queue:paused');
  }

  resumeQueue() {
    this.paused = false;
    this.emit('queue:resumed');
    this.processQueue();
  }

  // Generate unique upload ID
  generateUploadId() {
    return `upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  // Destroy queue with cleanup
  destroy() {
    clearInterval(this.cleanupInterval);
    clearInterval(this.metricsInterval);
    
    // Cancel all pending uploads
    this.queue.forEach(upload => {
      upload.status = UPLOAD_STATUS.CANCELLED;
      upload.cancelledAt = new Date();
      upload.cancellationReason = 'Queue destroyed';
    });
    
    this.removeAllListeners();
    this.queue = [];
    this.processing.clear();
    this.completed.clear();
    this.conflicts.clear();
    
    if (this.logger) {
      this.logger.logInfo('Upload queue destroyed');
    }
  }
}

// Singleton instance
let uploadQueue = null;

// Get or create upload queue instance
export function getUploadQueue(options) {
  if (!uploadQueue) {
    uploadQueue = new UploadQueue(options);
  }
  return uploadQueue;
}

// Create upload processor for price lists
export function createPriceListUploadProcessor(parsePriceListFile, validatePriceListData, createPriceList, createPriceListItems) {
  return async (uploadData, updateProgress) => {
    const { file, supplierId, userId } = uploadData;
    
    try {
      // Parse file (30% progress)
      updateProgress(10);
      const parseResult = await parsePriceListFile({
        filename: file.originalname,
        mimeType: file.mimetype,
        buffer: file.buffer
      });
      updateProgress(30);
      
      if (!parseResult.success) {
        throw new Error(parseResult.error);
      }
      
      // Standardize data (50% progress)
      updateProgress(40);
      const { priceList, items } = standardizePriceListData(
        parseResult,
        supplierId,
        userId
      );
      updateProgress(50);
      
      // Validate data (70% progress)
      updateProgress(60);
      const validation = validatePriceListData(priceList, items);
      if (!validation.valid) {
        throw new Error('Validation failed: ' + validation.errors.join(', '));
      }
      updateProgress(70);
      
      // Create price list (85% progress)
      updateProgress(75);
      const createdPriceList = await createPriceList(priceList);
      updateProgress(85);
      
      // Create items (100% progress)
      updateProgress(90);
      const itemsWithPriceListId = items.map(item => ({
        ...item,
        priceListId: createdPriceList.id
      }));
      const createdItems = await createPriceListItems(itemsWithPriceListId);
      updateProgress(100);
      
      return {
        priceList: createdPriceList,
        itemCount: createdItems.length,
        warnings: validation.warnings,
        summary: validation.summary
      };
    } catch (error) {
      throw error;
    }
  };
}

// Helper to standardize price list data (moved from index.js)
function standardizePriceListData(parsedData, supplierId, uploadedBy) {
  const { data, filename, fileType } = parsedData;
  
  const priceList = {
    supplierId,
    name: `Price List - ${new Date().toISOString().split('T')[0]}`,
    description: `Uploaded from ${filename}`,
    effectiveDate: new Date(),
    currency: 'USD',
    status: 'pending',
    uploadedBy,
    sourceFile: {
      filename,
      fileType,
      uploadDate: new Date()
    }
  };
  
  const items = data.map(item => ({
    sku: item.sku.trim(),
    description: item.description || '',
    unitPrice: item.unitPrice,
    currency: item.currency || 'USD',
    minimumOrderQuantity: item.minimumOrderQuantity || 1,
    unitOfMeasure: item.unitOfMeasure || 'EA',
    tierPricing: item.tierPricing || [],
    isActive: true
  }));
  
  return { priceList, items };
}