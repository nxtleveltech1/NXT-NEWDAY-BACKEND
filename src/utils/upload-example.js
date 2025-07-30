/**
 * Example usage of the upload queue and error handling system
 * This file demonstrates how to integrate the upload system into your application
 */

import { getUploadService, UPLOAD_PRIORITY, UPLOAD_STATUS } from '../services/upload.service.js';
import { getUploadMaintenance } from './upload-maintenance.js';

/**
 * Example: Setting up the upload service
 */
export function setupUploadService() {
  const uploadService = getUploadService({
    maxConcurrent: 5,          // Process up to 5 uploads simultaneously
    retryAttempts: 3,          // Retry failed uploads up to 3 times
    retryDelay: 1000,          // Start with 1 second delay
    maxRetryDelay: 30000,      // Maximum retry delay of 30 seconds
    logLevel: 'info',          // Log level: error, warn, info, debug
    enableConsole: true,       // Enable console logging
    enableFile: true           // Enable file logging
  });

  // Set up event listeners
  setupUploadEventListeners(uploadService);
  
  return uploadService;
}

/**
 * Example: Setting up event listeners for real-time monitoring
 */
function setupUploadEventListeners(uploadService) {
  // Upload queued
  uploadService.on('upload:queued', (upload) => {
    console.log(`Upload queued: ${upload.id} - ${upload.file?.originalname}`);
    // Emit to WebSocket clients for real-time UI updates
    // io.emit('upload:queued', { uploadId: upload.id, status: upload.status });
  });

  // Upload started processing
  uploadService.on('upload:started', (upload) => {
    console.log(`Upload processing started: ${upload.id}`);
    // Update UI with processing status
    // io.emit('upload:started', { uploadId: upload.id, status: upload.status });
  });

  // Upload progress updates
  uploadService.on('upload:progress', (progressData) => {
    console.log(`Upload progress: ${progressData.uploadId} - ${progressData.progress}%`);
    // Send progress updates to UI
    // io.emit('upload:progress', progressData);
  });

  // Upload completed successfully
  uploadService.on('upload:completed', (upload) => {
    console.log(`Upload completed: ${upload.id} - ${upload.result?.itemCount} items processed`);
    // Notify users of successful completion
    // sendNotification(upload.userId, 'Upload completed successfully', 'success');
    // io.emit('upload:completed', { uploadId: upload.id, result: upload.result });
  });

  // Upload failed
  uploadService.on('upload:failed', (upload) => {
    console.error(`Upload failed: ${upload.id} - ${upload.finalError?.error}`);
    // Send failure notification
    // sendNotification(upload.userId, 'Upload failed', 'error');
    // io.emit('upload:failed', { uploadId: upload.id, error: upload.finalError });
  });

  // Upload retry scheduled
  uploadService.on('upload:retry', (retryData) => {
    console.log(`Upload retry scheduled: ${retryData.upload.id} - Attempt ${retryData.upload.attempts}`);
    // io.emit('upload:retry', retryData);
  });

  // Upload cancelled
  uploadService.on('upload:cancelled', (upload) => {
    console.log(`Upload cancelled: ${upload.id} - ${upload.cancellationReason}`);
    // io.emit('upload:cancelled', { uploadId: upload.id, reason: upload.cancellationReason });
  });

  // Upload conflict detected
  uploadService.on('upload:conflict', (upload) => {
    console.warn(`Upload conflict: ${upload.id} - ${upload.conflictDetails?.conflicts} conflicts`);
    // Send conflict resolution request to UI
    // io.emit('upload:conflict', { 
    //   uploadId: upload.id, 
    //   conflicts: upload.conflictDetails,
    //   resolution: upload.conflictDetails.suggestedResolution 
    // });
  });

  // System health warnings
  uploadService.on('health:warning', (health) => {
    console.warn('Upload system health warning:', health);
    // Alert administrators
    // alertAdministrators('Upload system health warning', health);
  });
}

/**
 * Example: Upload a price list file
 */
export async function uploadPriceListExample(file, supplierId, userId, options = {}) {
  const uploadService = getUploadService();
  
  try {
    const uploadData = {
      file,
      supplierId,
      userId,
      priority: options.priority || UPLOAD_PRIORITY.NORMAL,
      metadata: {
        department: options.department || 'procurement',
        source: options.source || 'manual_upload',
        notes: options.notes
      }
    };

    const result = await uploadService.uploadPriceList(uploadData);
    
    if (result.status === 'conflict') {
      // Handle conflicts
      console.log('Upload has conflicts:', result.conflicts);
      
      // Example: Auto-resolve simple conflicts
      if (result.resolution?.strategy === 'queue_with_delay') {
        // Automatically proceed with delay
        await uploadService.resolveConflict(result.uploadId, {
          action: 'proceed',
          priority: UPLOAD_PRIORITY.LOW
        }, userId);
        
        return { 
          success: true, 
          uploadId: result.uploadId, 
          message: 'Upload queued with delay due to conflicts' 
        };
      } else {
        // Return conflicts for manual resolution
        return {
          success: false,
          uploadId: result.uploadId,
          conflicts: result.conflicts,
          resolution: result.resolution,
          message: 'Manual conflict resolution required'
        };
      }
    }

    return {
      success: true,
      uploadId: result.uploadId,
      status: result.status,
      position: result.position,
      estimatedWait: result.estimatedWait
    };

  } catch (error) {
    console.error('Upload failed:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Example: Monitor upload progress
 */
export async function monitorUploadProgress(uploadId) {
  const uploadService = getUploadService();
  
  return new Promise((resolve, reject) => {
    const checkProgress = () => {
      const status = uploadService.getUploadStatus(uploadId);
      
      if (!status) {
        reject(new Error('Upload not found'));
        return;
      }

      console.log(`Upload ${uploadId}: ${status.status} - ${status.progressPercent}%`);
      
      if (status.isCompleted) {
        if (status.status === UPLOAD_STATUS.COMPLETED) {
          resolve(status);
        } else {
          reject(new Error(`Upload failed: ${status.finalError?.error || 'Unknown error'}`));
        }
        return;
      }

      // Check again in 1 second
      setTimeout(checkProgress, 1000);
    };

    checkProgress();
  });
}

/**
 * Example: Handle upload conflicts
 */
export async function handleUploadConflict(uploadId, userChoice, userId) {
  const uploadService = getUploadService();
  
  try {
    let resolution;
    
    switch (userChoice) {
      case 'proceed':
        resolution = { action: 'proceed' };
        break;
        
      case 'cancel':
        resolution = { action: 'cancel' };
        break;
        
      case 'replace':
        resolution = { 
          action: 'replace',
          priority: UPLOAD_PRIORITY.HIGH 
        };
        break;
        
      case 'schedule_later':
        resolution = { 
          action: 'proceed',
          priority: UPLOAD_PRIORITY.LOW 
        };
        break;
        
      default:
        throw new Error('Invalid resolution choice');
    }

    const result = await uploadService.resolveConflict(uploadId, resolution, userId);
    
    return {
      success: result.success,
      message: result.message
    };

  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Example: Bulk operations
 */
export async function bulkUploadManagement() {
  const uploadService = getUploadService();
  
  // Get all pending uploads
  const pendingUploads = uploadService.getAllUploads({ 
    status: UPLOAD_STATUS.QUEUED 
  });
  
  console.log(`Found ${pendingUploads.length} pending uploads`);
  
  // Cancel old uploads (older than 1 hour)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const oldUploads = pendingUploads
    .filter(upload => upload.createdAt < oneHourAgo)
    .map(upload => upload.id);
  
  if (oldUploads.length > 0) {
    const cancelResults = await uploadService.bulkCancelUploads(
      oldUploads, 
      'Automatic cleanup - uploads older than 1 hour',
      'system'
    );
    
    console.log(`Cancelled ${cancelResults.filter(r => r.success).length} old uploads`);
  }
  
  // Increase priority for urgent uploads
  const urgentUploads = pendingUploads
    .filter(upload => upload.metadata?.urgent === true)
    .map(upload => upload.id);
  
  for (const uploadId of urgentUploads) {
    await uploadService.updateUploadPriority(uploadId, UPLOAD_PRIORITY.URGENT, 'system');
  }
  
  console.log(`Updated priority for ${urgentUploads.length} urgent uploads`);
}

/**
 * Example: System monitoring and alerts
 */
export async function monitorSystemHealth() {
  const uploadService = getUploadService();
  
  // Get current statistics
  const stats = uploadService.getStatistics();
  console.log('Upload System Statistics:', stats);
  
  // Check health status
  const health = uploadService.getHealthStatus();
  console.log('System Health:', health.status);
  
  if (health.status !== 'healthy') {
    console.warn('Health Issues:', health.issues);
    console.warn('Health Warnings:', health.warnings);
    
    // Send alerts to administrators
    // await sendAlertToAdministrators({
    //   type: 'upload_system_health',
    //   status: health.status,
    //   issues: health.issues,
    //   warnings: health.warnings,
    //   timestamp: health.timestamp
    // });
  }
  
  // Get recent error logs
  try {
    const logs = await uploadService.getSystemLogs({ hours: 1, limit: 10 });
    
    if (logs.recentErrors.length > 0) {
      console.log('Recent Errors:', logs.recentErrors.length);
      
      // Group errors by type
      const errorsByType = logs.recentErrors.reduce((acc, log) => {
        const errorType = log.metadata?.errorType || 'unknown';
        acc[errorType] = (acc[errorType] || 0) + 1;
        return acc;
      }, {});
      
      console.log('Error Breakdown:', errorsByType);
    }
  } catch (error) {
    console.error('Failed to get system logs:', error);
  }
}

/**
 * Example: Maintenance operations
 */
export async function performMaintenanceExample() {
  const maintenance = getUploadMaintenance({
    retentionDays: 30,        // Keep records for 30 days
    maxFileAge: 7,            // Clean temp files older than 7 days
    autoStart: false          // Don't start automatic maintenance
  });
  
  try {
    console.log('Starting manual maintenance...');
    
    const result = await maintenance.runMaintenance();
    
    console.log('Maintenance completed:', {
      uploadHistoryDeleted: result.uploadHistoryRecordsDeleted,
      tempFilesDeleted: result.tempFilesDeleted,
      logFilesDeleted: result.logFilesDeleted,
      databaseOptimized: result.databaseOptimized
    });
    
    if (result.report) {
      console.log('System Report:');
      console.log('- Total uploads (30 days):', result.report.uploadStatistics.totalUploads);
      console.log('- Success rate:', result.report.uploadStatistics.successRate + '%');
      console.log('- Total errors (7 days):', result.report.errorAnalysis.totalErrors);
    }
    
  } catch (error) {
    console.error('Maintenance failed:', error);
  }
}

/**
 * Example: Emergency procedures
 */
export async function emergencyProcedures() {
  const uploadService = getUploadService();
  const maintenance = getUploadMaintenance();
  
  // Pause the upload queue
  uploadService.pauseQueue();
  console.log('Upload queue paused');
  
  try {
    // Cancel all pending uploads
    const pendingUploads = uploadService.getAllUploads({ 
      status: UPLOAD_STATUS.QUEUED 
    });
    
    const uploadIds = pendingUploads.map(u => u.id);
    
    if (uploadIds.length > 0) {
      await uploadService.bulkCancelUploads(
        uploadIds, 
        'Emergency procedure - system maintenance',
        'system'
      );
      console.log(`Cancelled ${uploadIds.length} pending uploads`);
    }
    
    // Run emergency cleanup
    await maintenance.emergencyCleanup();
    console.log('Emergency cleanup completed');
    
    // Wait for processing uploads to complete
    let processingCount = uploadService.getStatistics().processing.total;
    let waitTime = 0;
    const maxWait = 10 * 60 * 1000; // 10 minutes
    
    while (processingCount > 0 && waitTime < maxWait) {
      console.log(`Waiting for ${processingCount} uploads to complete...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
      waitTime += 5000;
      processingCount = uploadService.getStatistics().processing.total;
    }
    
    console.log('Emergency procedures completed');
    
  } finally {
    // Resume the upload queue
    uploadService.resumeQueue();
    console.log('Upload queue resumed');
  }
}

/**
 * Example: Graceful shutdown
 */
export async function gracefulShutdown() {
  console.log('Starting graceful shutdown...');
  
  const uploadService = getUploadService();
  const maintenance = getUploadMaintenance();
  
  try {
    // Shutdown upload service (waits for current uploads)
    await uploadService.shutdown();
    console.log('Upload service shutdown completed');
    
    // Shutdown maintenance
    maintenance.shutdown();
    console.log('Maintenance shutdown completed');
    
  } catch (error) {
    console.error('Error during shutdown:', error);
  }
  
  console.log('Graceful shutdown completed');
}

// Example usage in an Express.js route
export function createUploadRoutes(app) {
  const uploadService = getUploadService();
  
  // Upload endpoint
  app.post('/api/uploads/price-lists', async (req, res) => {
    try {
      const { supplierId, priority, notes } = req.body;
      const file = req.file; // From multer middleware
      const userId = req.user.id; // From authentication middleware
      
      const result = await uploadPriceListExample(file, supplierId, userId, {
        priority: priority || UPLOAD_PRIORITY.NORMAL,
        notes
      });
      
      res.json(result);
      
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // Get upload status
  app.get('/api/uploads/:uploadId', (req, res) => {
    const status = uploadService.getUploadStatus(req.params.uploadId);
    
    if (!status) {
      return res.status(404).json({ error: 'Upload not found' });
    }
    
    res.json(status);
  });
  
  // Cancel upload
  app.delete('/api/uploads/:uploadId', async (req, res) => {
    try {
      const result = await uploadService.cancelUpload(
        req.params.uploadId,
        req.body.reason || 'User cancelled',
        req.user.id
      );
      
      res.json(result);
      
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // Resolve conflict
  app.post('/api/uploads/:uploadId/resolve-conflict', async (req, res) => {
    try {
      const result = await handleUploadConflict(
        req.params.uploadId,
        req.body.choice,
        req.user.id
      );
      
      res.json(result);
      
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // Get system statistics
  app.get('/api/uploads/system/stats', (req, res) => {
    const stats = uploadService.getStatistics();
    const health = uploadService.getHealthStatus();
    
    res.json({ stats, health });
  });
}