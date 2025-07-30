import Bull from 'bull';
import EventEmitter from 'events';
import { WebSocketServer } from 'ws';
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
  RETRYING: 'retrying',
  PAUSED: 'paused'
};

// Upload priority enum
export const UPLOAD_PRIORITY = {
  LOW: 1,
  NORMAL: 2,
  HIGH: 3,
  URGENT: 4,
  CRITICAL: 5
};

// Enhanced Upload Queue Manager with Bull and WebSocket support
export class EnhancedUploadQueue extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD,
        ...options.redis
      },
      maxConcurrentPerSupplier: options.maxConcurrentPerSupplier || 5,
      maxConcurrentTotal: options.maxConcurrentTotal || 20,
      retryAttempts: options.retryAttempts || 3,
      retryDelay: options.retryDelay || 1000,
      maxRetryDelay: options.maxRetryDelay || 30000,
      websocketPort: options.websocketPort || 4001,
      enableWebSocket: options.enableWebSocket !== false,
      ...options
    };
    
    // Initialize components
    this.logger = new UploadLogger();
    this.conflictDetector = new ConflictDetector();
    
    // Bull queues for different priorities
    this.queues = {};
    this.initializeQueues();
    
    // Processing state
    this.processingBySupplier = new Map();
    this.processingTotal = new Map();
    this.completed = new Map();
    this.conflicts = new Map();
    
    // Performance metrics
    this.metrics = {
      totalProcessed: 0,
      totalSuccessful: 0,
      totalFailed: 0,
      totalConflicts: 0,
      averageProcessingTime: 0,
      throughput: 0,
      queueDepth: 0,
      activeJobs: 0,
      completedJobs: 0,
      failedJobs: 0
    };
    
    // WebSocket server for real-time updates
    if (this.options.enableWebSocket) {
      this.initializeWebSocketServer();
    }
    
    // Start cleanup and metrics intervals
    this.startMaintenanceIntervals();
  }
  
  // Initialize Bull queues for different priority levels
  initializeQueues() {
    const priorities = Object.keys(UPLOAD_PRIORITY);
    
    priorities.forEach(priority => {
      const queueName = `upload-queue-${priority.toLowerCase()}`;
      const queue = new Bull(queueName, {
        redis: this.options.redis,
        defaultJobOptions: {
          removeOnComplete: true,
          removeOnFail: false,
          attempts: this.options.retryAttempts,
          backoff: {
            type: 'exponential',
            delay: this.options.retryDelay
          }
        }
      });
      
      // Set up queue event handlers
      this.setupQueueHandlers(queue, priority);
      
      // Process jobs with concurrency control
      queue.process(this.getProcessorConcurrency(priority), async (job) => {
        return this.processUploadJob(job);
      });
      
      this.queues[priority] = queue;
    });
  }
  
  // Get processor concurrency based on priority
  getProcessorConcurrency(priority) {
    const priorityValue = UPLOAD_PRIORITY[priority];
    if (priorityValue >= UPLOAD_PRIORITY.URGENT) {
      return Math.ceil(this.options.maxConcurrentTotal * 0.5); // 50% for urgent/critical
    } else if (priorityValue === UPLOAD_PRIORITY.HIGH) {
      return Math.ceil(this.options.maxConcurrentTotal * 0.3); // 30% for high
    } else {
      return Math.ceil(this.options.maxConcurrentTotal * 0.2); // 20% for normal/low
    }
  }
  
  // Set up queue event handlers
  setupQueueHandlers(queue, priority) {
    queue.on('active', (job) => {
      this.handleJobActive(job, priority);
    });
    
    queue.on('completed', (job, result) => {
      this.handleJobCompleted(job, result, priority);
    });
    
    queue.on('failed', (job, err) => {
      this.handleJobFailed(job, err, priority);
    });
    
    queue.on('progress', (job, progress) => {
      this.handleJobProgress(job, progress, priority);
    });
    
    queue.on('stalled', (job) => {
      this.logger.logWarning(`Job ${job.id} stalled in ${priority} queue`);
    });
    
    queue.on('error', (error) => {
      this.logger.logError(null, 'queue_error', error);
    });
  }
  
  // Initialize WebSocket server for real-time updates
  initializeWebSocketServer() {
    try {
      this.wss = new WebSocketServer({ 
        port: this.options.websocketPort,
        perMessageDeflate: {
          zlibDeflateOptions: {
            chunkSize: 1024,
            memLevel: 7,
            level: 3
          },
          zlibInflateOptions: {
            chunkSize: 10 * 1024
          },
          clientNoContextTakeover: true,
          serverNoContextTakeover: true,
          serverMaxWindowBits: 10,
          concurrencyLimit: 10,
          threshold: 1024
        }
      });
      
      this.wss.on('connection', (ws, req) => {
        const clientId = this.generateClientId();
        ws.clientId = clientId;
        ws.subscribedSuppliers = new Set();
        
        this.logger.logInfo(`WebSocket client connected: ${clientId}`);
        
        // Send initial connection message
        ws.send(JSON.stringify({
          type: 'connection',
          clientId,
          timestamp: new Date()
        }));
        
        ws.on('message', (message) => {
          this.handleWebSocketMessage(ws, message);
        });
        
        ws.on('close', () => {
          this.logger.logInfo(`WebSocket client disconnected: ${clientId}`);
        });
        
        ws.on('error', (error) => {
          this.logger.logError(clientId, 'websocket_error', error);
        });
      });
      
      this.logger.logInfo(`WebSocket server started on port ${this.options.websocketPort}`);
    } catch (error) {
      this.logger.logError(null, 'websocket_init_error', error);
    }
  }
  
  // Handle WebSocket messages
  handleWebSocketMessage(ws, message) {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'subscribe':
          if (data.supplierId) {
            ws.subscribedSuppliers.add(data.supplierId);
            ws.send(JSON.stringify({
              type: 'subscribed',
              supplierId: data.supplierId
            }));
          }
          break;
          
        case 'unsubscribe':
          if (data.supplierId) {
            ws.subscribedSuppliers.delete(data.supplierId);
            ws.send(JSON.stringify({
              type: 'unsubscribed',
              supplierId: data.supplierId
            }));
          }
          break;
          
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
          
        default:
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Unknown message type'
          }));
      }
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Invalid message format'
      }));
    }
  }
  
  // Broadcast WebSocket message to relevant clients
  broadcastToClients(supplierId, message) {
    if (!this.wss) return;
    
    const messageStr = JSON.stringify({
      ...message,
      timestamp: new Date()
    });
    
    this.wss.clients.forEach(client => {
      if (client.readyState === 1 && // WebSocket.OPEN
          (!supplierId || client.subscribedSuppliers.has(supplierId))) {
        client.send(messageStr);
      }
    });
  }
  
  // Enhanced enqueue method with Bull integration
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
        this.broadcastToClients(upload.supplierId, {
          type: 'upload:conflict',
          uploadId,
          conflicts: conflictCheck.details
        });
        
        return {
          uploadId,
          status: 'conflict',
          conflicts: conflictCheck.details,
          resolution: conflictCheck.suggestedResolution
        };
      }
      
      // Check concurrent uploads for supplier
      const supplierConcurrent = this.getSupplierConcurrentCount(upload.supplierId);
      if (supplierConcurrent >= this.options.maxConcurrentPerSupplier) {
        upload.metadata.delayedReason = 'supplier_concurrency_limit';
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
      
      // Get the appropriate queue based on priority
      const priorityKey = this.getPriorityKey(upload.priority);
      const queue = this.queues[priorityKey];
      
      if (!queue) {
        throw new Error(`Invalid priority: ${upload.priority}`);
      }
      
      // Add job to Bull queue
      const job = await queue.add(upload, {
        priority: upload.priority,
        delay: upload.metadata.delayedReason ? 5000 : 0, // Delay if rate limited
        removeOnComplete: true,
        removeOnFail: false
      });
      
      await this.logger.logUploadQueued(upload);
      this.emit('upload:queued', upload);
      this.broadcastToClients(upload.supplierId, {
        type: 'upload:queued',
        uploadId,
        position: await this.getQueuePosition(uploadId),
        estimatedWait: await this.estimateWaitTime(upload.priority)
      });
      
      return {
        uploadId,
        jobId: job.id,
        status: 'queued',
        position: await this.getQueuePosition(uploadId),
        estimatedWait: await this.estimateWaitTime(upload.priority)
      };
      
    } catch (error) {
      await this.logger.logError(uploadId, 'queue_error', error);
      throw new Error(`Failed to queue upload: ${error.message}`);
    }
  }
  
  // Process upload job
  async processUploadJob(job) {
    const upload = job.data;
    const uploadId = upload.id;
    
    try {
      // Update processing state
      this.updateProcessingState(upload, true);
      
      // Validate upload before processing
      const validationResult = await this.validateUpload(upload);
      if (!validationResult.valid) {
        throw new Error(`Upload validation failed: ${validationResult.errors.join(', ')}`);
      }
      
      await job.progress(5);
      this.broadcastProgress(upload, 5, 'Validation completed');
      
      // Execute the upload processor with progress tracking
      const result = await this.executeUploadProcessor(upload, job);
      
      // Update database record
      if (upload.historyId) {
        await updateUploadHistoryStatus(upload.historyId, 'completed', {
          itemCount: result.itemCount || 0,
          successCount: result.itemCount || 0,
          metadata: { result, duration: Date.now() - upload.createdAt.getTime() }
        });
      }
      
      // Update processing state
      this.updateProcessingState(upload, false);
      
      // Store in completed map
      upload.status = UPLOAD_STATUS.COMPLETED;
      upload.completedAt = new Date();
      upload.result = result;
      this.completed.set(uploadId, upload);
      
      // Update metrics
      this.metrics.totalSuccessful++;
      this.metrics.totalProcessed++;
      
      // Broadcast completion
      this.broadcastToClients(upload.supplierId, {
        type: 'upload:completed',
        uploadId,
        result
      });
      
      return result;
      
    } catch (error) {
      // Update processing state
      this.updateProcessingState(upload, false);
      
      // Let Bull handle retry logic
      throw error;
    }
  }
  
  // Execute upload processor with timeout and progress tracking
  async executeUploadProcessor(upload, job) {
    const processingTimeout = upload.timeout || 300000; // 5 minutes default
    const startTime = Date.now();
    
    const updateProgress = async (progress, details = {}) => {
      upload.progress = Math.min(100, Math.max(0, progress));
      upload.progressDetails = details;
      upload.lastProgressUpdate = new Date();
      
      await job.progress(progress);
      
      this.broadcastProgress(upload, progress, details.message || details.stage);
    };
    
    return new Promise(async (resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Upload ${upload.id} timed out after ${processingTimeout}ms`));
      }, processingTimeout);
      
      try {
        const result = await upload.processor(upload.data, updateProgress);
        clearTimeout(timeoutId);
        resolve(result);
      } catch (error) {
        clearTimeout(timeoutId);
        reject(error);
      }
    });
  }
  
  // Broadcast progress update
  broadcastProgress(upload, progress, stage) {
    this.emit('upload:progress', {
      uploadId: upload.id,
      progress,
      stage,
      estimatedTimeRemaining: this.calculateTimeRemaining(upload)
    });
    
    this.broadcastToClients(upload.supplierId, {
      type: 'upload:progress',
      uploadId: upload.id,
      progress,
      stage,
      estimatedTimeRemaining: this.calculateTimeRemaining(upload)
    });
  }
  
  // Update processing state for concurrency control
  updateProcessingState(upload, isProcessing) {
    const supplierId = upload.supplierId;
    
    if (isProcessing) {
      // Add to processing maps
      if (!this.processingBySupplier.has(supplierId)) {
        this.processingBySupplier.set(supplierId, new Set());
      }
      this.processingBySupplier.get(supplierId).add(upload.id);
      this.processingTotal.set(upload.id, upload);
    } else {
      // Remove from processing maps
      if (this.processingBySupplier.has(supplierId)) {
        this.processingBySupplier.get(supplierId).delete(upload.id);
        if (this.processingBySupplier.get(supplierId).size === 0) {
          this.processingBySupplier.delete(supplierId);
        }
      }
      this.processingTotal.delete(upload.id);
    }
  }
  
  // Get supplier concurrent count
  getSupplierConcurrentCount(supplierId) {
    return this.processingBySupplier.has(supplierId) ? 
      this.processingBySupplier.get(supplierId).size : 0;
  }
  
  // Handle job active event
  handleJobActive(job, priority) {
    const upload = job.data;
    upload.status = UPLOAD_STATUS.PROCESSING;
    upload.startedAt = new Date();
    
    this.logger.logUploadStarted(upload);
    this.emit('upload:started', upload);
    this.broadcastToClients(upload.supplierId, {
      type: 'upload:started',
      uploadId: upload.id
    });
    
    this.metrics.activeJobs++;
  }
  
  // Handle job completed event
  handleJobCompleted(job, result, priority) {
    const upload = job.data;
    
    this.logger.logUploadCompleted(upload);
    this.emit('upload:completed', upload);
    
    this.metrics.activeJobs--;
    this.metrics.completedJobs++;
  }
  
  // Handle job failed event
  async handleJobFailed(job, err, priority) {
    const upload = job.data;
    const errorInfo = {
      attempt: job.attemptsMade,
      error: err.message,
      stack: err.stack,
      timestamp: new Date(),
      type: this.categorizeError(err)
    };
    
    upload.errors.push(errorInfo);
    
    await this.logger.logUploadError(upload, err);
    
    // Check if this is the final attempt
    if (job.attemptsMade >= this.options.retryAttempts) {
      upload.status = UPLOAD_STATUS.FAILED;
      upload.failedAt = new Date();
      upload.finalError = errorInfo;
      
      // Update database record
      if (upload.historyId) {
        await updateUploadHistoryStatus(upload.historyId, 'failed', {
          errorCount: upload.errors.length,
          errors: upload.errors,
          metadata: { finalError: errorInfo }
        });
      }
      
      this.completed.set(upload.id, upload);
      
      await this.logger.logUploadFailed(upload);
      this.emit('upload:failed', upload);
      this.broadcastToClients(upload.supplierId, {
        type: 'upload:failed',
        uploadId: upload.id,
        error: errorInfo
      });
      
      this.metrics.totalFailed++;
      this.metrics.failedJobs++;
    } else {
      // Retry notification
      this.emit('upload:retry', {
        upload,
        attempt: job.attemptsMade,
        nextAttempt: job.attemptsMade + 1
      });
      this.broadcastToClients(upload.supplierId, {
        type: 'upload:retry',
        uploadId: upload.id,
        attempt: job.attemptsMade,
        nextAttempt: job.attemptsMade + 1
      });
    }
    
    this.metrics.activeJobs--;
  }
  
  // Handle job progress event
  handleJobProgress(job, progress, priority) {
    const upload = job.data;
    upload.progress = progress;
    
    // Progress is already broadcast in executeUploadProcessor
  }
  
  // Get queue position across all priority queues
  async getQueuePosition(uploadId) {
    let position = 0;
    
    for (const [priority, queue] of Object.entries(this.queues)) {
      const jobs = await queue.getJobs(['waiting', 'delayed']);
      const jobIndex = jobs.findIndex(job => job.data.id === uploadId);
      
      if (jobIndex !== -1) {
        return position + jobIndex + 1;
      }
      
      position += jobs.length;
    }
    
    return null;
  }
  
  // Estimate wait time based on priority and current queue state
  async estimateWaitTime(priority) {
    const avgProcessingTime = this.metrics.averageProcessingTime || 60000;
    let totalJobsAhead = 0;
    
    // Count jobs in higher or equal priority queues
    for (const [queuePriority, queue] of Object.entries(this.queues)) {
      const priorityValue = UPLOAD_PRIORITY[queuePriority];
      if (priorityValue >= priority) {
        const waitingJobs = await queue.getWaitingCount();
        const delayedJobs = await queue.getDelayedCount();
        totalJobsAhead += waitingJobs + delayedJobs;
      }
    }
    
    const concurrency = this.options.maxConcurrentTotal;
    return Math.ceil((totalJobsAhead / concurrency) * avgProcessingTime);
  }
  
  // Get upload status with enhanced Bull queue information
  async getUploadStatus(uploadId) {
    // Check conflicts first
    if (this.conflicts.has(uploadId)) {
      const upload = this.conflicts.get(uploadId);
      return {
        ...upload,
        position: null,
        estimatedWait: null
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
    
    // Check processing
    if (this.processingTotal.has(uploadId)) {
      const upload = this.processingTotal.get(uploadId);
      return {
        ...upload,
        position: null,
        estimatedWait: this.calculateTimeRemaining(upload)
      };
    }
    
    // Check Bull queues
    for (const [priority, queue] of Object.entries(this.queues)) {
      const job = await queue.getJob(uploadId);
      if (job) {
        const state = await job.getState();
        return {
          ...job.data,
          status: this.mapBullStateToStatus(state),
          position: state === 'waiting' ? await this.getQueuePosition(uploadId) : null,
          estimatedWait: state === 'waiting' ? await this.estimateWaitTime(job.data.priority) : null,
          attempts: job.attemptsMade,
          progress: job.progress()
        };
      }
    }
    
    return null;
  }
  
  // Map Bull job state to upload status
  mapBullStateToStatus(state) {
    const stateMap = {
      'waiting': UPLOAD_STATUS.QUEUED,
      'active': UPLOAD_STATUS.PROCESSING,
      'completed': UPLOAD_STATUS.COMPLETED,
      'failed': UPLOAD_STATUS.FAILED,
      'delayed': UPLOAD_STATUS.QUEUED,
      'paused': UPLOAD_STATUS.PAUSED
    };
    
    return stateMap[state] || UPLOAD_STATUS.QUEUED;
  }
  
  // Cancel upload with Bull queue integration
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
      this.broadcastToClients(upload.supplierId, {
        type: 'upload:cancelled',
        uploadId,
        reason
      });
      
      return { success: true, message: 'Upload cancelled successfully' };
    }
    
    // Check Bull queues
    for (const [priority, queue] of Object.entries(this.queues)) {
      const job = await queue.getJob(uploadId);
      if (job) {
        const state = await job.getState();
        
        if (state === 'active') {
          // Mark for cancellation - the processor should check this
          job.data.cancellationRequested = true;
          job.data.cancellationReason = reason;
          await job.update(job.data);
          
          this.emit('upload:cancellation_requested', job.data);
          this.broadcastToClients(job.data.supplierId, {
            type: 'upload:cancellation_requested',
            uploadId,
            reason
          });
          
          return {
            success: false,
            message: 'Upload is currently processing. Cancellation requested.',
            pending: true
          };
        } else {
          // Remove from queue
          await job.remove();
          
          const upload = job.data;
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
          this.broadcastToClients(upload.supplierId, {
            type: 'upload:cancelled',
            uploadId,
            reason
          });
          
          return { success: true, message: 'Upload removed from queue' };
        }
      }
    }
    
    // Check if already completed
    if (this.completed.has(uploadId)) {
      return { success: false, message: 'Upload already completed' };
    }
    
    return { success: false, message: 'Upload not found' };
  }
  
  // Pause specific upload
  async pauseUpload(uploadId) {
    for (const [priority, queue] of Object.entries(this.queues)) {
      const job = await queue.getJob(uploadId);
      if (job) {
        const state = await job.getState();
        if (state === 'waiting' || state === 'delayed') {
          await job.pause();
          
          this.emit('upload:paused', job.data);
          this.broadcastToClients(job.data.supplierId, {
            type: 'upload:paused',
            uploadId
          });
          
          return { success: true, message: 'Upload paused' };
        }
      }
    }
    
    return { success: false, message: 'Upload not found or cannot be paused' };
  }
  
  // Resume specific upload
  async resumeUpload(uploadId) {
    for (const [priority, queue] of Object.entries(this.queues)) {
      const job = await queue.getJob(uploadId);
      if (job) {
        const state = await job.getState();
        if (state === 'paused') {
          await job.resume();
          
          this.emit('upload:resumed', job.data);
          this.broadcastToClients(job.data.supplierId, {
            type: 'upload:resumed',
            uploadId
          });
          
          return { success: true, message: 'Upload resumed' };
        }
      }
    }
    
    return { success: false, message: 'Upload not found or not paused' };
  }
  
  // Requeue failed upload
  async requeueFailedUpload(uploadId, options = {}) {
    if (!this.completed.has(uploadId)) {
      return { success: false, message: 'Upload not found in completed list' };
    }
    
    const upload = this.completed.get(uploadId);
    if (upload.status !== UPLOAD_STATUS.FAILED) {
      return { success: false, message: 'Upload did not fail' };
    }
    
    // Reset upload state
    upload.status = UPLOAD_STATUS.QUEUED;
    upload.attempts = 0;
    upload.errors = [];
    upload.progress = 0;
    upload.queuedAt = new Date();
    delete upload.failedAt;
    delete upload.finalError;
    
    // Apply any new options
    if (options.priority) {
      upload.priority = options.priority;
    }
    
    // Remove from completed
    this.completed.delete(uploadId);
    
    // Re-enqueue
    return await this.enqueue(upload);
  }
  
  // Get comprehensive queue statistics with Bull integration
  async getStatistics() {
    const stats = {
      queue: {
        total: 0,
        byPriority: {},
        byState: {},
        avgWaitTime: 0
      },
      processing: {
        total: this.processingTotal.size,
        bySupplier: {},
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
      },
      redis: {
        connected: false,
        memory: null
      },
      websocket: {
        enabled: this.options.enableWebSocket,
        clients: this.wss ? this.wss.clients.size : 0
      }
    };
    
    // Get queue statistics from Bull
    for (const [priority, queue] of Object.entries(this.queues)) {
      const waiting = await queue.getWaitingCount();
      const active = await queue.getActiveCount();
      const completed = await queue.getCompletedCount();
      const failed = await queue.getFailedCount();
      const delayed = await queue.getDelayedCount();
      const paused = await queue.getPausedCount();
      
      stats.queue.byPriority[priority] = {
        waiting,
        active,
        completed,
        failed,
        delayed,
        paused,
        total: waiting + active + delayed + paused
      };
      
      stats.queue.total += waiting + active + delayed + paused;
    }
    
    // Calculate processing statistics by supplier
    this.processingBySupplier.forEach((uploadIds, supplierId) => {
      stats.processing.bySupplier[supplierId] = uploadIds.size;
    });
    
    // Calculate average progress
    let totalProgress = 0;
    this.processingTotal.forEach(upload => {
      totalProgress += upload.progress || 0;
    });
    stats.processing.avgProgress = this.processingTotal.size > 0 ? 
      (totalProgress / this.processingTotal.size).toFixed(1) : 0;
    
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
    
    // Check Redis connection
    try {
      const firstQueue = Object.values(this.queues)[0];
      if (firstQueue && firstQueue.client) {
        stats.redis.connected = firstQueue.client.status === 'ready';
        if (stats.redis.connected) {
          const info = await firstQueue.client.info('memory');
          const usedMemory = info.match(/used_memory_human:([^\r\n]+)/);
          stats.redis.memory = usedMemory ? usedMemory[1] : null;
        }
      }
    } catch (error) {
      // Redis info failed
    }
    
    return stats;
  }
  
  // Get all uploads with filtering and pagination
  async getAllUploads(filters = {}) {
    const all = [];
    
    // Get uploads from Bull queues
    for (const [priority, queue] of Object.entries(this.queues)) {
      const jobs = await queue.getJobs(['waiting', 'active', 'completed', 'failed', 'delayed', 'paused']);
      jobs.forEach(job => {
        all.push({
          ...job.data,
          jobId: job.id,
          state: job.opts.delay ? 'delayed' : 'queued',
          attempts: job.attemptsMade
        });
      });
    }
    
    // Add completed uploads
    this.completed.forEach(upload => all.push(upload));
    
    // Add conflicts
    this.conflicts.forEach(upload => all.push(upload));
    
    // Apply filters
    let filtered = all;
    
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
      filtered = filtered.filter(upload => new Date(upload.createdAt) >= dateFrom);
    }
    
    if (filters.dateTo) {
      const dateTo = new Date(filters.dateTo);
      filtered = filtered.filter(upload => new Date(upload.createdAt) <= dateTo);
    }
    
    // Sort
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
    
    // Apply pagination
    if (filters.page && filters.pageSize) {
      const start = (filters.page - 1) * filters.pageSize;
      const end = start + filters.pageSize;
      return {
        data: filtered.slice(start, end),
        total: filtered.length,
        page: filters.page,
        pageSize: filters.pageSize,
        totalPages: Math.ceil(filtered.length / filters.pageSize)
      };
    }
    
    return filtered;
  }
  
  // Pause all queues
  async pauseAllQueues() {
    for (const queue of Object.values(this.queues)) {
      await queue.pause();
    }
    this.emit('queues:paused');
    this.broadcastToClients(null, { type: 'queues:paused' });
  }
  
  // Resume all queues
  async resumeAllQueues() {
    for (const queue of Object.values(this.queues)) {
      await queue.resume();
    }
    this.emit('queues:resumed');
    this.broadcastToClients(null, { type: 'queues:resumed' });
  }
  
  // Clear completed jobs older than specified time
  async clearOldCompleted(olderThan = 3600000) { // 1 hour default
    const cutoff = new Date(Date.now() - olderThan);
    let cleared = 0;
    
    for (const [id, upload] of this.completed.entries()) {
      if (upload.completedAt && upload.completedAt < cutoff) {
        this.completed.delete(id);
        cleared++;
      }
    }
    
    // Also clean Bull completed jobs
    for (const queue of Object.values(this.queues)) {
      await queue.clean(olderThan, 'completed');
    }
    
    this.logger.logInfo(`Cleared ${cleared} old completed uploads`);
    return cleared;
  }
  
  // Get health status
  async getHealthStatus() {
    const stats = await this.getStatistics();
    const issues = [];
    const warnings = [];
    
    // Check queue depth
    if (stats.queue.total > 100) {
      issues.push('Queue depth is very high (>100 jobs)');
    } else if (stats.queue.total > 50) {
      warnings.push('Queue depth is getting high (>50 jobs)');
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
    
    // Check Redis connection
    if (!stats.redis.connected) {
      issues.push('Redis connection is down');
    }
    
    // Check WebSocket clients
    if (this.options.enableWebSocket && stats.websocket.clients === 0) {
      warnings.push('No WebSocket clients connected');
    }
    
    return {
      status: issues.length > 0 ? 'unhealthy' : warnings.length > 0 ? 'warning' : 'healthy',
      issues,
      warnings,
      stats,
      timestamp: new Date()
    };
  }
  
  // Helper methods
  
  getPriorityKey(priorityValue) {
    for (const [key, value] of Object.entries(UPLOAD_PRIORITY)) {
      if (value === priorityValue) {
        return key;
      }
    }
    return 'NORMAL';
  }
  
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
  
  calculateTimeRemaining(upload) {
    if (!upload.startedAt || !upload.progress || upload.progress === 0) {
      return null;
    }
    
    const elapsed = Date.now() - new Date(upload.startedAt).getTime();
    const rate = upload.progress / elapsed;
    const remaining = (100 - upload.progress) / rate;
    
    return Math.max(0, remaining);
  }
  
  generateUploadId() {
    return `upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  generateClientId() {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  validateUpload(upload) {
    const errors = [];
    
    if (!upload.file) errors.push('File is required');
    if (!upload.supplierId) errors.push('Supplier ID is required');
    if (!upload.userId) errors.push('User ID is required');
    if (!upload.processor) errors.push('Processor function is required');
    
    const maxFileSize = 50 * 1024 * 1024; // 50MB
    if (upload.file && upload.file.size > maxFileSize) {
      errors.push(`File size exceeds maximum limit of ${maxFileSize} bytes`);
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
  
  // Start maintenance intervals
  startMaintenanceIntervals() {
    // Cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.clearOldCompleted();
    }, 60 * 60 * 1000); // Every hour
    
    // Metrics update interval
    this.metricsInterval = setInterval(() => {
      this.updateMetrics();
    }, 30 * 1000); // Every 30 seconds
    
    // Health check interval
    this.healthInterval = setInterval(async () => {
      const health = await this.getHealthStatus();
      if (health.status === 'unhealthy') {
        this.logger.logError(null, 'health_check', new Error(`System unhealthy: ${health.issues.join(', ')}`));
      }
    }, 5 * 60 * 1000); // Every 5 minutes
  }
  
  // Update performance metrics
  async updateMetrics() {
    this.metrics.totalProcessed = this.metrics.totalSuccessful + this.metrics.totalFailed;
    
    // Calculate average processing time from completed uploads
    const completedUploads = Array.from(this.completed.values())
      .filter(upload => upload.completedAt && upload.startedAt && upload.status === UPLOAD_STATUS.COMPLETED);
    
    if (completedUploads.length > 0) {
      const totalTime = completedUploads.reduce((sum, upload) => {
        return sum + (new Date(upload.completedAt).getTime() - new Date(upload.startedAt).getTime());
      }, 0);
      this.metrics.averageProcessingTime = totalTime / completedUploads.length;
    }
    
    // Calculate throughput (uploads per minute)
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const recentCompletions = completedUploads.filter(upload => 
      new Date(upload.completedAt).getTime() > oneMinuteAgo
    );
    
    this.metrics.throughput = recentCompletions.length;
    
    // Update queue depth
    this.metrics.queueDepth = 0;
    for (const queue of Object.values(this.queues)) {
      this.metrics.queueDepth += await queue.getWaitingCount();
      this.metrics.queueDepth += await queue.getDelayedCount();
    }
  }
  
  // Destroy queue with cleanup
  async destroy() {
    // Clear intervals
    clearInterval(this.cleanupInterval);
    clearInterval(this.metricsInterval);
    clearInterval(this.healthInterval);
    
    // Close WebSocket server
    if (this.wss) {
      this.wss.clients.forEach(client => {
        client.send(JSON.stringify({
          type: 'shutdown',
          message: 'Queue shutting down'
        }));
        client.close();
      });
      this.wss.close();
    }
    
    // Close Bull queues
    for (const queue of Object.values(this.queues)) {
      await queue.close();
    }
    
    this.removeAllListeners();
    
    if (this.logger) {
      this.logger.logInfo('Enhanced upload queue destroyed');
    }
  }
}

// Singleton instance
let enhancedUploadQueue = null;

// Get or create enhanced upload queue instance
export function getEnhancedUploadQueue(options) {
  if (!enhancedUploadQueue) {
    enhancedUploadQueue = new EnhancedUploadQueue(options);
  }
  return enhancedUploadQueue;
}

// Export the original functions for backward compatibility
export { createPriceListUploadProcessor } from './upload-queue.js';