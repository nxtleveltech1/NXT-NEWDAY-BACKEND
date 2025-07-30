import { getEnhancedUploadQueue, UPLOAD_PRIORITY } from './upload-queue-enhanced.js';
import { getUploadWebSocketHandler } from './upload-websocket-handler.js';

// Example: Initialize enhanced upload queue with Bull and WebSocket support
export async function initializeEnhancedUploadQueue() {
  console.log('🚀 Initializing Enhanced Upload Queue...');
  
  // Create upload queue with enhanced options
  const uploadQueue = getEnhancedUploadQueue({
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD
    },
    maxConcurrentPerSupplier: 5,    // Max 5 concurrent uploads per supplier
    maxConcurrentTotal: 20,          // Max 20 concurrent uploads total
    retryAttempts: 3,               // Retry failed uploads 3 times
    retryDelay: 2000,               // Initial retry delay: 2 seconds
    maxRetryDelay: 60000,           // Max retry delay: 1 minute
    websocketPort: 4001,            // WebSocket server port
    enableWebSocket: true           // Enable WebSocket support
  });
  
  // Start WebSocket handler
  const wsHandler = getUploadWebSocketHandler({
    port: 4001,
    uploadQueue: uploadQueue
  });
  
  await wsHandler.start();
  
  console.log('✅ Enhanced Upload Queue initialized successfully');
  console.log('📡 WebSocket server running on port 4001');
  
  return { uploadQueue, wsHandler };
}

// Example: Queue a high-priority price list upload
export async function queuePriceListUpload(file, supplierId, userId) {
  const uploadQueue = getEnhancedUploadQueue();
  
  const uploadData = {
    file: file,
    supplierId: supplierId,
    userId: userId,
    fileType: 'EXCEL',
    priority: UPLOAD_PRIORITY.HIGH,  // High priority
    metadata: {
      uploadType: 'price_list',
      source: 'supplier_portal'
    },
    processor: createPriceListProcessor(), // Your processor function
    timeout: 300000  // 5 minute timeout
  };
  
  try {
    const result = await uploadQueue.enqueue(uploadData);
    console.log('📤 Upload queued:', result);
    return result;
  } catch (error) {
    console.error('❌ Failed to queue upload:', error);
    throw error;
  }
}

// Example: Queue an urgent inventory update
export async function queueUrgentInventoryUpdate(file, supplierId, userId) {
  const uploadQueue = getEnhancedUploadQueue();
  
  const uploadData = {
    file: file,
    supplierId: supplierId,
    userId: userId,
    fileType: 'CSV',
    priority: UPLOAD_PRIORITY.URGENT,  // Urgent priority
    metadata: {
      uploadType: 'inventory_update',
      source: 'api',
      urgent: true
    },
    processor: createInventoryProcessor(),
    timeout: 180000  // 3 minute timeout
  };
  
  try {
    const result = await uploadQueue.enqueue(uploadData);
    console.log('🚨 Urgent upload queued:', result);
    return result;
  } catch (error) {
    console.error('❌ Failed to queue urgent upload:', error);
    throw error;
  }
}

// Example: Monitor upload progress
export function monitorUploadProgress(uploadId) {
  const uploadQueue = getEnhancedUploadQueue();
  
  // Listen for progress updates
  uploadQueue.on('upload:progress', (data) => {
    if (data.uploadId === uploadId) {
      console.log(`📊 Upload ${uploadId} progress: ${data.progress}% - ${data.stage}`);
      if (data.estimatedTimeRemaining) {
        console.log(`⏱️  Estimated time remaining: ${Math.ceil(data.estimatedTimeRemaining / 1000)}s`);
      }
    }
  });
  
  // Listen for completion
  uploadQueue.on('upload:completed', (upload) => {
    if (upload.id === uploadId) {
      console.log(`✅ Upload ${uploadId} completed successfully!`);
      console.log('📋 Result:', upload.result);
    }
  });
  
  // Listen for failures
  uploadQueue.on('upload:failed', (upload) => {
    if (upload.id === uploadId) {
      console.error(`❌ Upload ${uploadId} failed:`, upload.finalError);
    }
  });
  
  // Listen for retries
  uploadQueue.on('upload:retry', (data) => {
    if (data.upload.id === uploadId) {
      console.log(`🔄 Upload ${uploadId} retrying (attempt ${data.nextAttempt})...`);
    }
  });
}

// Example: Get queue statistics
export async function getQueueStatistics() {
  const uploadQueue = getEnhancedUploadQueue();
  const stats = await uploadQueue.getStatistics();
  
  console.log('\n📊 Upload Queue Statistics:');
  console.log('=====================================');
  console.log(`📥 Queue Total: ${stats.queue.total}`);
  console.log(`⚡ Processing: ${stats.processing.total}`);
  console.log(`✅ Completed: ${stats.completed.total}`);
  console.log(`  - Successful: ${stats.completed.successful}`);
  console.log(`  - Failed: ${stats.completed.failed}`);
  console.log(`  - Cancelled: ${stats.completed.cancelled}`);
  console.log(`⚠️  Conflicts: ${stats.conflicts.total}`);
  console.log('\n📈 Performance Metrics:');
  console.log(`  - Success Rate: ${stats.performance.successRate}%`);
  console.log(`  - Failure Rate: ${stats.performance.failureRate}%`);
  console.log(`  - Avg Processing Time: ${Math.ceil(stats.performance.averageProcessingTime / 1000)}s`);
  console.log(`  - Throughput: ${stats.performance.throughput} uploads/min`);
  console.log('\n🔌 Connections:');
  console.log(`  - Redis: ${stats.redis.connected ? '✅ Connected' : '❌ Disconnected'}`);
  console.log(`  - WebSocket Clients: ${stats.websocket.clients}`);
  
  return stats;
}

// Example: Handle upload conflicts
export async function handleUploadConflict(uploadId, resolution) {
  const uploadQueue = getEnhancedUploadQueue();
  
  try {
    const result = await uploadQueue.resolveConflict(uploadId, resolution);
    console.log('✅ Conflict resolved:', result);
    return result;
  } catch (error) {
    console.error('❌ Failed to resolve conflict:', error);
    throw error;
  }
}

// Example: Cancel an upload
export async function cancelUpload(uploadId, reason) {
  const uploadQueue = getEnhancedUploadQueue();
  
  try {
    const result = await uploadQueue.cancelUpload(uploadId, reason);
    console.log('🚫 Upload cancelled:', result);
    return result;
  } catch (error) {
    console.error('❌ Failed to cancel upload:', error);
    throw error;
  }
}

// Example: Pause/Resume upload
export async function pauseUpload(uploadId) {
  const uploadQueue = getEnhancedUploadQueue();
  
  try {
    const result = await uploadQueue.pauseUpload(uploadId);
    console.log('⏸️  Upload paused:', result);
    return result;
  } catch (error) {
    console.error('❌ Failed to pause upload:', error);
    throw error;
  }
}

export async function resumeUpload(uploadId) {
  const uploadQueue = getEnhancedUploadQueue();
  
  try {
    const result = await uploadQueue.resumeUpload(uploadId);
    console.log('▶️  Upload resumed:', result);
    return result;
  } catch (error) {
    console.error('❌ Failed to resume upload:', error);
    throw error;
  }
}

// Example: Requeue failed upload
export async function requeueFailedUpload(uploadId, newPriority) {
  const uploadQueue = getEnhancedUploadQueue();
  
  try {
    const result = await uploadQueue.requeueFailedUpload(uploadId, {
      priority: newPriority || UPLOAD_PRIORITY.HIGH
    });
    console.log('🔄 Upload requeued:', result);
    return result;
  } catch (error) {
    console.error('❌ Failed to requeue upload:', error);
    throw error;
  }
}

// Example: Monitor queue health
export async function monitorQueueHealth() {
  const uploadQueue = getEnhancedUploadQueue();
  
  setInterval(async () => {
    const health = await uploadQueue.getHealthStatus();
    
    if (health.status === 'unhealthy') {
      console.error('🚨 Queue Health Alert:');
      health.issues.forEach(issue => console.error(`  ❌ ${issue}`));
    } else if (health.status === 'warning') {
      console.warn('⚠️  Queue Health Warning:');
      health.warnings.forEach(warning => console.warn(`  ⚠️  ${warning}`));
    } else {
      console.log('✅ Queue Health: Good');
    }
  }, 60000); // Check every minute
}

// Example: WebSocket client for monitoring uploads
export function createWebSocketClient(supplierId) {
  const WebSocket = require('ws');
  const ws = new WebSocket('ws://localhost:4001');
  
  ws.on('open', () => {
    console.log('🔌 Connected to upload queue WebSocket');
    
    // Subscribe to supplier
    ws.send(JSON.stringify({
      type: 'subscribe',
      supplierId: supplierId
    }));
  });
  
  ws.on('message', (data) => {
    const message = JSON.parse(data);
    
    switch (message.type) {
      case 'upload:queued':
        console.log(`📥 New upload queued: ${message.upload.id}`);
        break;
        
      case 'upload:progress':
        console.log(`📊 Upload ${message.uploadId}: ${message.progress}% - ${message.stage}`);
        break;
        
      case 'upload:completed':
        console.log(`✅ Upload completed: ${message.upload.id}`);
        break;
        
      case 'upload:failed':
        console.error(`❌ Upload failed: ${message.upload.id}`);
        break;
        
      case 'queue:stats':
        console.log(`📈 Queue stats - Total: ${message.stats.queue.total}, Active: ${message.stats.processing.total}`);
        break;
    }
  });
  
  ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error);
  });
  
  ws.on('close', () => {
    console.log('🔌 Disconnected from upload queue WebSocket');
  });
  
  return ws;
}

// Example processor functions
function createPriceListProcessor() {
  return async (uploadData, updateProgress) => {
    // Simulate processing stages
    updateProgress(10, { stage: 'validation', message: 'Validating file format' });
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    updateProgress(30, { stage: 'parsing', message: 'Parsing price list data' });
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    updateProgress(60, { stage: 'processing', message: 'Processing price items' });
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    updateProgress(90, { stage: 'saving', message: 'Saving to database' });
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    updateProgress(100, { stage: 'completed', message: 'Price list imported successfully' });
    
    return {
      itemCount: 150,
      successCount: 148,
      warnings: ['2 items had invalid prices and were skipped'],
      summary: 'Price list imported with 148 valid items'
    };
  };
}

function createInventoryProcessor() {
  return async (uploadData, updateProgress) => {
    updateProgress(20, { stage: 'validation', message: 'Validating inventory data' });
    await new Promise(resolve => setTimeout(resolve, 500));
    
    updateProgress(50, { stage: 'processing', message: 'Updating inventory levels' });
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    updateProgress(80, { stage: 'reconciliation', message: 'Reconciling stock levels' });
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    updateProgress(100, { stage: 'completed', message: 'Inventory updated successfully' });
    
    return {
      itemCount: 75,
      updatedCount: 73,
      warnings: ['2 SKUs not found in system'],
      summary: 'Inventory updated for 73 items'
    };
  };
}

// Example: Graceful shutdown
export async function gracefulShutdown() {
  console.log('\n🛑 Shutting down upload queue...');
  
  const uploadQueue = getEnhancedUploadQueue();
  const wsHandler = getUploadWebSocketHandler();
  
  // Pause all queues
  await uploadQueue.pauseAllQueues();
  console.log('⏸️  All queues paused');
  
  // Wait for active jobs to complete (with timeout)
  const timeout = 30000; // 30 seconds
  const startTime = Date.now();
  
  while (uploadQueue.processingTotal.size > 0 && Date.now() - startTime < timeout) {
    console.log(`⏳ Waiting for ${uploadQueue.processingTotal.size} active uploads to complete...`);
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  // Stop WebSocket server
  await wsHandler.stop();
  console.log('🔌 WebSocket server stopped');
  
  // Destroy upload queue
  await uploadQueue.destroy();
  console.log('✅ Upload queue shutdown complete');
}

// Example usage
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    try {
      // Initialize
      await initializeEnhancedUploadQueue();
      
      // Monitor health
      monitorQueueHealth();
      
      // Show stats every 30 seconds
      setInterval(async () => {
        await getQueueStatistics();
      }, 30000);
      
      // Handle graceful shutdown
      process.on('SIGINT', async () => {
        await gracefulShutdown();
        process.exit(0);
      });
      
      console.log('\n🎯 Enhanced Upload Queue is running!');
      console.log('Press Ctrl+C to shutdown gracefully\n');
      
    } catch (error) {
      console.error('❌ Failed to start enhanced upload queue:', error);
      process.exit(1);
    }
  })();
}