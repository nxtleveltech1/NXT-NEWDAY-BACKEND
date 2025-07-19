# Upload Queue & Error Handling System

A comprehensive, production-ready upload queue system for handling concurrent price list uploads with robust error handling, conflict detection, and retry mechanisms.

## Features

### Core Capabilities
- **Concurrent Processing**: Handle multiple uploads simultaneously with configurable concurrency limits
- **Priority Queue**: Support for upload priorities (LOW, NORMAL, HIGH, URGENT, CRITICAL)
- **Conflict Detection**: Automatic detection of duplicate uploads, active price lists, and rate limits
- **Retry Mechanisms**: Exponential backoff retry with intelligent error categorization
- **Progress Tracking**: Real-time progress monitoring with estimated completion times
- **Comprehensive Logging**: Structured logging with search and analysis capabilities
- **Health Monitoring**: System health checks and performance metrics
- **Maintenance**: Automated cleanup and optimization

### Error Handling
- **Smart Retry Logic**: Only retry transient errors (network, timeout, database)
- **Error Categorization**: Automatic classification of error types
- **Failure Analysis**: Detailed error reporting and trending
- **Graceful Degradation**: System continues operating despite individual failures

### Conflict Resolution
- **Duplicate Detection**: Prevents duplicate file uploads within configurable time windows
- **Rate Limiting**: Enforces daily and hourly upload limits per supplier
- **Concurrent Upload Management**: Coordinates uploads from multiple users
- **Active Price List Checks**: Warns about replacing recently activated price lists

## Components

### 1. Upload Queue Manager (`upload-queue.js`)
Central queue management with priority handling and concurrent processing.

```javascript
import { getUploadQueue, UPLOAD_PRIORITY } from '../utils/upload-queue.js';

const queue = getUploadQueue({
  maxConcurrent: 5,
  retryAttempts: 3,
  retryDelay: 1000
});

const uploadId = await queue.enqueue({
  file,
  supplierId,
  userId,
  priority: UPLOAD_PRIORITY.HIGH,
  processor: uploadProcessor
});
```

### 2. Upload Logger (`upload-logger.js`)
Structured logging with file rotation and search capabilities.

```javascript
import { getUploadLogger } from '../utils/upload-logger.js';

const logger = getUploadLogger({
  logLevel: 'info',
  enableFile: true,
  maxFileSize: 10 * 1024 * 1024 // 10MB
});

logger.logUploadStarted(upload);
logger.logUploadError(upload, error);
```

### 3. Conflict Detector (`upload-conflict-detector.js`)
Intelligent conflict detection and resolution suggestions.

```javascript
import { ConflictDetector } from '../utils/upload-conflict-detector.js';

const detector = new ConflictDetector({
  maxFileSize: 50 * 1024 * 1024,
  maxDailyUploads: 50,
  maxHourlyUploads: 10
});

const conflicts = await detector.checkForConflicts(upload);
```

### 4. Upload Service (`upload.service.js`)
High-level service interface that coordinates all components.

```javascript
import { getUploadService, UPLOAD_PRIORITY } from '../services/upload.service.js';

const uploadService = getUploadService();

const result = await uploadService.uploadPriceList({
  file,
  supplierId,
  userId,
  priority: UPLOAD_PRIORITY.NORMAL
});
```

### 5. Maintenance System (`upload-maintenance.js`)
Automated cleanup and system maintenance.

```javascript
import { getUploadMaintenance } from '../utils/upload-maintenance.js';

const maintenance = getUploadMaintenance({
  retentionDays: 30,
  autoStart: true
});
```

## Usage Examples

### Basic Upload
```javascript
import { getUploadService, UPLOAD_PRIORITY } from '../services/upload.service.js';

const uploadService = getUploadService();

// Upload a price list
const result = await uploadService.uploadPriceList({
  file: req.file,
  supplierId: 'supplier-123',
  userId: 'user-456',
  priority: UPLOAD_PRIORITY.NORMAL,
  metadata: {
    department: 'procurement',
    notes: 'Q3 pricing update'
  }
});

if (result.status === 'conflict') {
  // Handle conflicts
  console.log('Conflicts detected:', result.conflicts);
} else {
  console.log('Upload queued:', result.uploadId);
}
```

### Monitoring Progress
```javascript
// Set up event listeners
uploadService.on('upload:progress', (data) => {
  console.log(`Upload ${data.uploadId}: ${data.progress}%`);
  // Update UI with progress
});

uploadService.on('upload:completed', (upload) => {
  console.log(`Upload completed: ${upload.result.itemCount} items processed`);
});

uploadService.on('upload:failed', (upload) => {
  console.error(`Upload failed: ${upload.finalError.error}`);
});
```

### Conflict Resolution
```javascript
// Handle upload conflicts
const conflictResolution = {
  action: 'proceed',      // 'proceed', 'cancel', 'replace'
  priority: UPLOAD_PRIORITY.HIGH,
  resolvedBy: userId
};

await uploadService.resolveConflict(uploadId, conflictResolution, userId);
```

### System Monitoring
```javascript
// Get system statistics
const stats = uploadService.getStatistics();
console.log('Queue length:', stats.queue.total);
console.log('Success rate:', stats.performance.successRate);

// Check system health
const health = uploadService.getHealthStatus();
if (health.status !== 'healthy') {
  console.warn('System issues:', health.issues);
}
```

## Configuration

### Queue Configuration
```javascript
const uploadService = getUploadService({
  maxConcurrent: 5,          // Max simultaneous uploads
  retryAttempts: 3,          // Max retry attempts
  retryDelay: 1000,          // Initial retry delay (ms)
  maxRetryDelay: 30000,      // Maximum retry delay (ms)
  logLevel: 'info'           // Logging level
});
```

### Conflict Detection Configuration
```javascript
uploadService.configureConflictDetection({
  maxFileSize: 50 * 1024 * 1024,  // 50MB file size limit
  maxDailyUploads: 50,             // Max uploads per supplier per day
  maxHourlyUploads: 10,            // Max uploads per supplier per hour
  maintenanceMode: false           // System maintenance mode
});
```

### Logging Configuration
```javascript
const logger = getUploadLogger({
  logLevel: 'info',               // error, warn, info, debug
  logDir: './logs/uploads',       // Log directory
  maxFileSize: 10 * 1024 * 1024, // 10MB max log file size
  maxFiles: 10,                   // Keep 10 log files
  enableConsole: true,            // Console logging
  enableFile: true                // File logging
});
```

## API Reference

### Upload Status
```javascript
{
  id: 'upload_123',
  status: 'processing',           // queued, processing, completed, failed, cancelled, conflict
  progress: 75,                   // 0-100
  isActive: true,                 // Is currently active
  isCompleted: false,             // Has finished (success or failure)
  canCancel: false,               // Can be cancelled
  canRetry: false,                // Can be retried
  progressPercent: 75,            // Rounded progress
  durationSeconds: 45,            // Processing duration
  estimatedTimeRemaining: 15000,  // Estimated time remaining (ms)
  position: null,                 // Position in queue (if queued)
  priority: 2,                    // Upload priority
  attempts: 1,                    // Number of attempts
  errors: [],                     // Error history
  warnings: [],                   // Warning messages
  metadata: {}                    // Custom metadata
}
```

### Upload Result
```javascript
{
  uploadId: 'upload_123',
  status: 'queued',              // queued, conflict
  position: 3,                   // Position in queue
  estimatedWait: 45000,          // Estimated wait time (ms)
  conflicts: [],                 // Conflict details (if any)
  resolution: {}                 // Suggested resolution (if conflicts)
}
```

### System Statistics
```javascript
{
  queue: {
    total: 5,                    // Total queued uploads
    byPriority: { 2: 3, 3: 2 }, // Count by priority
    bySupplier: {},              // Count by supplier
    avgWaitTime: 30000           // Average wait time
  },
  processing: {
    total: 2,                    // Currently processing
    avgProgress: 45.5            // Average progress
  },
  completed: {
    total: 150,                  // Total completed
    successful: 140,             // Successful uploads
    failed: 8,                   // Failed uploads
    cancelled: 2                 // Cancelled uploads
  },
  performance: {
    totalProcessed: 150,         // Total processed
    totalSuccessful: 140,        // Total successful
    successRate: 93.33,          // Success rate percentage
    averageProcessingTime: 45000, // Average processing time (ms)
    throughput: 5                // Uploads per minute
  }
}
```

## Error Handling

### Error Categories
- **timeout**: Processing timeouts
- **network**: Network connectivity issues
- **validation**: Data validation errors
- **permission**: Authorization errors
- **file_processing**: File parsing errors
- **database**: Database operation errors
- **resource**: Memory/resource constraints
- **unknown**: Uncategorized errors

### Retry Logic
- Only retryable errors are retried (timeout, network, database)
- Exponential backoff with jitter to prevent thundering herd
- Maximum retry delay cap to prevent excessive delays
- Validation and permission errors are not retried

### Error Recovery
```javascript
// Handle different error types
uploadService.on('upload:failed', (upload) => {
  const errorType = upload.finalError.type;
  
  switch (errorType) {
    case 'validation':
      // File format or data issues - notify user
      notifyUser('Please check file format and try again');
      break;
      
    case 'permission':
      // Authorization issues - check permissions
      checkUserPermissions(upload.userId);
      break;
      
    case 'resource':
      // System resource issues - alert administrators
      alertAdministrators('System resource constraints detected');
      break;
      
    default:
      // General error handling
      logError(upload);
  }
});
```

## Event System

The upload system emits events for real-time monitoring:

- `upload:queued` - Upload added to queue
- `upload:started` - Processing started
- `upload:progress` - Progress update
- `upload:completed` - Processing completed successfully
- `upload:failed` - Processing failed permanently
- `upload:retry` - Retry scheduled
- `upload:cancelled` - Upload cancelled
- `upload:conflict` - Conflict detected
- `upload:conflict_resolved` - Conflict resolved
- `health:warning` - System health warning

## Maintenance

### Automatic Maintenance
- Runs every 24 hours by default
- Cleans old upload history (30 days retention)
- Removes orphaned price list items
- Cleans temporary files
- Optimizes database tables

### Manual Maintenance
```javascript
const maintenance = getUploadMaintenance();

// Run maintenance manually
const result = await maintenance.runMaintenance();

// Emergency cleanup
await maintenance.emergencyCleanup();

// Force cleanup specific upload
await maintenance.forceCleanupUpload(uploadId);
```

## Production Deployment

### Performance Tuning
- Set appropriate `maxConcurrent` based on system resources
- Configure database connection pooling
- Use Redis for distributed queue management (future enhancement)
- Set up log aggregation (ELK stack, Splunk, etc.)

### Monitoring
- Set up alerts for high failure rates
- Monitor queue length and processing times
- Track system health metrics
- Monitor disk space for logs and temp files

### Scaling
- Use load balancers for multiple application instances
- Consider Redis-based queue for horizontal scaling
- Implement database read replicas for reporting
- Use object storage for large file uploads

## Security Considerations

- Validate file types and sizes before processing
- Scan uploaded files for malware
- Implement rate limiting per user/IP
- Use secure file storage with proper permissions
- Audit all upload activities
- Encrypt sensitive data in logs

## Troubleshooting

### Common Issues

1. **High Memory Usage**
   - Reduce `maxConcurrent` setting
   - Check for memory leaks in file processors
   - Increase system memory or implement streaming

2. **Slow Processing**
   - Check database performance
   - Optimize file parsing logic
   - Consider parallel processing for large files

3. **High Failure Rate**
   - Check system resources
   - Review error logs for patterns
   - Validate file formats and supplier data

4. **Queue Backup**
   - Increase concurrent processing
   - Check for blocking operations
   - Review upload priorities

### Debug Mode
```javascript
const uploadService = getUploadService({
  logLevel: 'debug',  // Enable debug logging
  enableConsole: true
});

// Monitor all events
uploadService.onAny((event, data) => {
  console.log(`Event: ${event}`, data);
});
```

This comprehensive upload system provides enterprise-grade reliability and monitoring for price list uploads while maintaining flexibility for future enhancements.