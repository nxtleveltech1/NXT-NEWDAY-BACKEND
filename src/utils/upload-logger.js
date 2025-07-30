import fs from 'fs/promises';
import path from 'path';

// Log levels
export const LOG_LEVELS = {
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  DEBUG: 'debug'
};

// Upload-specific log categories
export const LOG_CATEGORIES = {
  QUEUE: 'queue',
  PROCESSING: 'processing',
  CONFLICT: 'conflict',
  RETRY: 'retry',
  VALIDATION: 'validation',
  PERFORMANCE: 'performance'
};

/**
 * Enhanced upload logging system with structured logging and monitoring
 */
export class UploadLogger {
  constructor(options = {}) {
    this.logLevel = options.logLevel || LOG_LEVELS.INFO;
    this.logDir = options.logDir || path.join(process.cwd(), 'logs', 'uploads');
    this.maxFileSize = options.maxFileSize || 10 * 1024 * 1024; // 10MB
    this.maxFiles = options.maxFiles || 10;
    this.enableConsole = options.enableConsole !== false;
    this.enableFile = options.enableFile !== false;
    
    // Create logs directory if it doesn't exist
    this.ensureLogDirectory();
    
    // Log aggregation for metrics
    this.logBuffer = [];
    this.bufferFlushInterval = 5000; // 5 seconds
    this.startLogBuffer();
  }

  async ensureLogDirectory() {
    try {
      await fs.mkdir(this.logDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create log directory:', error);
    }
  }

  startLogBuffer() {
    setInterval(() => {
      this.flushLogBuffer();
    }, this.bufferFlushInterval);
  }

  async flushLogBuffer() {
    if (this.logBuffer.length === 0) return;

    const logs = [...this.logBuffer];
    this.logBuffer = [];

    try {
      await this.writeLogsToFile(logs);
    } catch (error) {
      console.error('Failed to flush log buffer:', error);
      // Put logs back in buffer for retry
      this.logBuffer.unshift(...logs);
    }
  }

  async writeLogsToFile(logs) {
    if (!this.enableFile) return;

    const logFile = path.join(this.logDir, `upload-${this.getDateString()}.log`);
    const logLines = logs.map(log => JSON.stringify(log)).join('\n') + '\n';

    try {
      await fs.appendFile(logFile, logLines);
      await this.rotateLogsIfNeeded(logFile);
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }

  async rotateLogsIfNeeded(logFile) {
    try {
      const stats = await fs.stat(logFile);
      if (stats.size > this.maxFileSize) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const rotatedFile = logFile.replace('.log', `.${timestamp}.log`);
        await fs.rename(logFile, rotatedFile);
        
        // Clean up old log files
        await this.cleanupOldLogs();
      }
    } catch (error) {
      // File might not exist yet, which is fine
    }
  }

  async cleanupOldLogs() {
    try {
      const files = await fs.readdir(this.logDir);
      const logFiles = files
        .filter(file => file.startsWith('upload-') && file.endsWith('.log'))
        .map(file => ({
          name: file,
          path: path.join(this.logDir, file),
          time: fs.stat(path.join(this.logDir, file)).then(stats => stats.mtime)
        }));

      // Resolve all stat promises
      for (const logFile of logFiles) {
        logFile.time = await logFile.time;
      }

      // Sort by modification time (newest first)
      logFiles.sort((a, b) => b.time - a.time);

      // Remove old files beyond maxFiles limit
      if (logFiles.length > this.maxFiles) {
        const filesToDelete = logFiles.slice(this.maxFiles);
        for (const file of filesToDelete) {
          await fs.unlink(file.path);
        }
      }
    } catch (error) {
      console.error('Failed to cleanup old logs:', error);
    }
  }

  getDateString() {
    return new Date().toISOString().split('T')[0];
  }

  log(level, category, message, metadata = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
      metadata,
      pid: process.pid
    };

    // Add to buffer for file logging
    this.logBuffer.push(logEntry);

    // Console logging
    if (this.enableConsole && this.shouldLog(level)) {
      this.writeToConsole(logEntry);
    }

    return logEntry;
  }

  shouldLog(level) {
    const levels = [LOG_LEVELS.ERROR, LOG_LEVELS.WARN, LOG_LEVELS.INFO, LOG_LEVELS.DEBUG];
    const currentLevelIndex = levels.indexOf(this.logLevel);
    const messageLevelIndex = levels.indexOf(level);
    return messageLevelIndex <= currentLevelIndex;
  }

  writeToConsole(logEntry) {
    const { timestamp, level, category, message, metadata } = logEntry;
    const metaStr = Object.keys(metadata).length > 0 ? ` | ${JSON.stringify(metadata)}` : '';
    const logMessage = `[${timestamp}] ${level.toUpperCase()} [${category}] ${message}${metaStr}`;

    switch (level) {
      case LOG_LEVELS.ERROR:
        console.error(logMessage);
        break;
      case LOG_LEVELS.WARN:
        console.warn(logMessage);
        break;
      case LOG_LEVELS.DEBUG:
        console.debug(logMessage);
        break;
      default:
        console.log(logMessage);
    }
  }

  // Upload-specific logging methods
  logUploadQueued(upload) {
    return this.log(LOG_LEVELS.INFO, LOG_CATEGORIES.QUEUE, 'Upload queued', {
      uploadId: upload.id,
      supplierId: upload.supplierId,
      fileName: upload.file?.originalname,
      fileSize: upload.file?.size,
      priority: upload.priority,
      queuePosition: upload.position
    });
  }

  logUploadStarted(upload) {
    return this.log(LOG_LEVELS.INFO, LOG_CATEGORIES.PROCESSING, 'Upload processing started', {
      uploadId: upload.id,
      supplierId: upload.supplierId,
      fileName: upload.file?.originalname,
      queueWaitTime: upload.startedAt - upload.queuedAt
    });
  }

  logUploadProgress(upload, progress, details) {
    return this.log(LOG_LEVELS.DEBUG, LOG_CATEGORIES.PROCESSING, 'Upload progress update', {
      uploadId: upload.id,
      progress,
      details,
      estimatedTimeRemaining: details.estimatedTimeRemaining
    });
  }

  logUploadCompleted(upload) {
    return this.log(LOG_LEVELS.INFO, LOG_CATEGORIES.PROCESSING, 'Upload completed successfully', {
      uploadId: upload.id,
      supplierId: upload.supplierId,
      fileName: upload.file?.originalname,
      duration: upload.duration,
      itemCount: upload.result?.itemCount,
      warnings: upload.result?.warnings?.length || 0
    });
  }

  logUploadError(upload, error) {
    return this.log(LOG_LEVELS.ERROR, LOG_CATEGORIES.PROCESSING, 'Upload processing error', {
      uploadId: upload.id,
      supplierId: upload.supplierId,
      fileName: upload.file?.originalname,
      attempt: upload.attempts,
      error: error.message,
      errorType: this.categorizeError(error),
      stack: error.stack
    });
  }

  logUploadFailed(upload) {
    return this.log(LOG_LEVELS.ERROR, LOG_CATEGORIES.PROCESSING, 'Upload failed permanently', {
      uploadId: upload.id,
      supplierId: upload.supplierId,
      fileName: upload.file?.originalname,
      totalAttempts: upload.attempts,
      totalDuration: upload.duration,
      finalError: upload.finalError?.error,
      errorHistory: upload.errors.map(e => ({
        attempt: e.attempt,
        error: e.error,
        type: e.type
      }))
    });
  }

  logUploadRetry(upload, retryInfo) {
    return this.log(LOG_LEVELS.WARN, LOG_CATEGORIES.RETRY, 'Upload retry scheduled', {
      uploadId: upload.id,
      supplierId: upload.supplierId,
      attempt: upload.attempts,
      nextRetryAt: retryInfo.nextRetryAt,
      retryDelay: retryInfo.retryDelay,
      reason: upload.errors[upload.errors.length - 1]?.error
    });
  }

  logUploadCancelled(upload, reason) {
    return this.log(LOG_LEVELS.WARN, LOG_CATEGORIES.PROCESSING, 'Upload cancelled', {
      uploadId: upload.id,
      supplierId: upload.supplierId,
      fileName: upload.file?.originalname,
      reason,
      status: upload.status,
      progress: upload.progress
    });
  }

  logConflict(upload, conflictCheck) {
    return this.log(LOG_LEVELS.WARN, LOG_CATEGORIES.CONFLICT, 'Upload conflict detected', {
      uploadId: upload.id,
      supplierId: upload.supplierId,
      fileName: upload.file?.originalname,
      conflicts: conflictCheck.details,
      suggestedResolution: conflictCheck.suggestedResolution
    });
  }

  logConflictResolved(upload, resolution) {
    return this.log(LOG_LEVELS.INFO, LOG_CATEGORIES.CONFLICT, 'Upload conflict resolved', {
      uploadId: upload.id,
      supplierId: upload.supplierId,
      resolution: resolution.action,
      resolvedBy: resolution.resolvedBy
    });
  }

  logValidationError(upload, errors) {
    return this.log(LOG_LEVELS.ERROR, LOG_CATEGORIES.VALIDATION, 'Upload validation failed', {
      uploadId: upload.id,
      supplierId: upload.supplierId,
      fileName: upload.file?.originalname,
      errors,
      errorCount: errors.length
    });
  }

  logPerformanceMetric(metric, value, metadata = {}) {
    return this.log(LOG_LEVELS.INFO, LOG_CATEGORIES.PERFORMANCE, `Performance metric: ${metric}`, {
      metric,
      value,
      ...metadata
    });
  }

  logError(uploadId, context, error) {
    return this.log(LOG_LEVELS.ERROR, LOG_CATEGORIES.PROCESSING, `Error in ${context}`, {
      uploadId,
      context,
      error: error.message,
      stack: error.stack
    });
  }

  logInfo(message, metadata = {}) {
    return this.log(LOG_LEVELS.INFO, LOG_CATEGORIES.QUEUE, message, metadata);
  }

  // Error categorization helper
  categorizeError(error) {
    const message = error.message.toLowerCase();
    
    if (message.includes('timeout')) return 'timeout';
    if (message.includes('network') || message.includes('connection')) return 'network';
    if (message.includes('validation') || message.includes('invalid')) return 'validation';
    if (message.includes('permission') || message.includes('unauthorized')) return 'permission';
    if (message.includes('file') || message.includes('parse')) return 'file_processing';
    if (message.includes('database') || message.includes('sql')) return 'database';
    if (message.includes('memory') || message.includes('out of')) return 'resource';
    
    return 'unknown';
  }

  // Get log statistics
  async getLogStatistics(hours = 24) {
    const sinceTime = new Date(Date.now() - hours * 60 * 60 * 1000);
    
    try {
      const logFiles = await fs.readdir(this.logDir);
      const recentLogs = [];
      
      for (const file of logFiles) {
        if (file.startsWith('upload-') && file.endsWith('.log')) {
          const filePath = path.join(this.logDir, file);
          const content = await fs.readFile(filePath, 'utf8');
          const lines = content.split('\n').filter(line => line.trim());
          
          for (const line of lines) {
            try {
              const logEntry = JSON.parse(line);
              if (new Date(logEntry.timestamp) > sinceTime) {
                recentLogs.push(logEntry);
              }
            } catch (parseError) {
              // Skip invalid JSON lines
            }
          }
        }
      }
      
      // Calculate statistics
      const stats = {
        totalLogs: recentLogs.length,
        byLevel: {},
        byCategory: {},
        errorTypes: {},
        topErrors: {},
        timeRange: {
          start: sinceTime.toISOString(),
          end: new Date().toISOString()
        }
      };
      
      recentLogs.forEach(log => {
        // Count by level
        stats.byLevel[log.level] = (stats.byLevel[log.level] || 0) + 1;
        
        // Count by category
        stats.byCategory[log.category] = (stats.byCategory[log.category] || 0) + 1;
        
        // Count error types
        if (log.level === LOG_LEVELS.ERROR && log.metadata?.errorType) {
          stats.errorTypes[log.metadata.errorType] = (stats.errorTypes[log.metadata.errorType] || 0) + 1;
        }
        
        // Track top error messages
        if (log.level === LOG_LEVELS.ERROR && log.metadata?.error) {
          const errorKey = log.metadata.error.substring(0, 100); // Truncate for grouping
          stats.topErrors[errorKey] = (stats.topErrors[errorKey] || 0) + 1;
        }
      });
      
      return stats;
    } catch (error) {
      console.error('Failed to get log statistics:', error);
      return null;
    }
  }

  // Search logs
  async searchLogs(query, options = {}) {
    const { 
      level = null, 
      category = null, 
      hours = 24,
      limit = 100 
    } = options;
    
    const sinceTime = new Date(Date.now() - hours * 60 * 60 * 1000);
    
    try {
      const logFiles = await fs.readdir(this.logDir);
      const matchingLogs = [];
      
      for (const file of logFiles) {
        if (file.startsWith('upload-') && file.endsWith('.log')) {
          const filePath = path.join(this.logDir, file);
          const content = await fs.readFile(filePath, 'utf8');
          const lines = content.split('\n').filter(line => line.trim());
          
          for (const line of lines) {
            try {
              const logEntry = JSON.parse(line);
              
              // Filter by time
              if (new Date(logEntry.timestamp) <= sinceTime) continue;
              
              // Filter by level
              if (level && logEntry.level !== level) continue;
              
              // Filter by category
              if (category && logEntry.category !== category) continue;
              
              // Search in message and metadata
              const searchText = JSON.stringify(logEntry).toLowerCase();
              if (searchText.includes(query.toLowerCase())) {
                matchingLogs.push(logEntry);
                
                if (matchingLogs.length >= limit) {
                  return matchingLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                }
              }
            } catch (parseError) {
              // Skip invalid JSON lines
            }
          }
        }
      }
      
      return matchingLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    } catch (error) {
      console.error('Failed to search logs:', error);
      return [];
    }
  }

  // Cleanup and shutdown
  async shutdown() {
    await this.flushLogBuffer();
  }
}

// Default logger instance
let defaultLogger = null;

export function getUploadLogger(options) {
  if (!defaultLogger) {
    defaultLogger = new UploadLogger(options);
  }
  return defaultLogger;
}