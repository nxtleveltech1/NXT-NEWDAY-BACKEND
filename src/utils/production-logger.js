import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { createHash } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Production-Grade Logging System for NXT Backend
 * Features: Structured logging, correlation IDs, performance tracking, security logging
 */

// Enhanced log levels with custom priorities
const logLevels = {
  emergency: 0, // System unusable
  alert: 1,     // Action must be taken immediately
  critical: 2,  // Critical conditions
  error: 3,     // Error conditions
  warn: 4,      // Warning conditions
  notice: 5,    // Normal but significant condition
  info: 6,      // Informational messages
  debug: 7,     // Debug-level messages
  trace: 8      // Very detailed debug information
};

const logColors = {
  emergency: 'magenta',
  alert: 'red',
  critical: 'red',
  error: 'red',
  warn: 'yellow',
  notice: 'cyan',
  info: 'green',
  debug: 'blue',
  trace: 'gray'
};

winston.addColors(logColors);

// Production log format with enhanced metadata
const productionFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.metadata({ 
    fillExcept: ['message', 'level', 'timestamp', 'service', 'correlationId'] 
  }),
  winston.format.json(),
  winston.format.printf(info => {
    const { timestamp, level, message, service, correlationId, metadata, stack } = info;
    
    const logEntry = {
      timestamp,
      level,
      service,
      correlationId,
      message,
      ...metadata
    };

    if (stack) {
      logEntry.stack = stack;
    }

    return JSON.stringify(logEntry);
  })
);

// Development console format
const developmentFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
  winston.format.align(),
  winston.format.printf(info => {
    const { timestamp, level, service, correlationId, message, metadata } = info;
    const metaStr = metadata && Object.keys(metadata).length > 0 
      ? `\n${JSON.stringify(metadata, null, 2)}` 
      : '';
    const corrId = correlationId ? `[${correlationId.slice(0, 8)}]` : '';
    return `${timestamp} ${level} [${service}]${corrId}: ${message}${metaStr}`;
  })
);

// Environment configuration
const isProduction = process.env.NODE_ENV === 'production';
const isDevelopment = process.env.NODE_ENV === 'development';
const logLevel = process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug');

// Create logs directory
const logDir = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Create transports array
const transports = [];

// Console transport
if (!isProduction || process.env.LOG_CONSOLE === 'true') {
  transports.push(
    new winston.transports.Console({
      level: logLevel,
      format: isDevelopment ? developmentFormat : productionFormat,
      handleExceptions: true,
      handleRejections: true
    })
  );
}

// File transports for production
if (isProduction || process.env.LOG_TO_FILE === 'true') {
  // Combined log file
  transports.push(
    new winston.transports.File({
      filename: path.join(logDir, 'application.log'),
      level: logLevel,
      format: productionFormat,
      maxsize: 100 * 1024 * 1024, // 100MB
      maxFiles: 20,
      tailable: true,
      handleExceptions: true,
      handleRejections: true
    })
  );

  // Error-only log file
  transports.push(
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      format: productionFormat,
      maxsize: 50 * 1024 * 1024, // 50MB
      maxFiles: 10,
      tailable: true
    })
  );

  // Security events log
  transports.push(
    new winston.transports.File({
      filename: path.join(logDir, 'security.log'),
      level: 'info',
      format: productionFormat,
      maxsize: 30 * 1024 * 1024, // 30MB
      maxFiles: 15,
      tailable: true
    })
  );

  // Performance metrics log
  transports.push(
    new winston.transports.File({
      filename: path.join(logDir, 'performance.log'),
      level: 'info',
      format: productionFormat,
      maxsize: 50 * 1024 * 1024, // 50MB
      maxFiles: 10,
      tailable: true
    })
  );

  // Audit trail log
  transports.push(
    new winston.transports.File({
      filename: path.join(logDir, 'audit.log'),
      level: 'info',
      format: productionFormat,
      maxsize: 100 * 1024 * 1024, // 100MB
      maxFiles: 30,
      tailable: true
    })
  );
}

// External logging service (if configured)
if (process.env.EXTERNAL_LOG_URL && isProduction) {
  transports.push(
    new winston.transports.Http({
      host: process.env.EXTERNAL_LOG_HOST,
      port: process.env.EXTERNAL_LOG_PORT || 443,
      path: process.env.EXTERNAL_LOG_PATH || '/logs',
      ssl: true,
      level: 'warn',
      format: productionFormat,
      auth: {
        username: process.env.EXTERNAL_LOG_USER,
        password: process.env.EXTERNAL_LOG_PASS
      }
    })
  );
}

// Create main logger
const logger = winston.createLogger({
  level: logLevel,
  levels: logLevels,
  format: productionFormat,
  defaultMeta: {
    service: 'nxt-backend',
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    hostname: process.env.HOSTNAME || require('os').hostname(),
    pid: process.pid,
    instanceId: process.env.INSTANCE_ID || createHash('md5').update(`${process.pid}-${Date.now()}`).digest('hex').slice(0, 8)
  },
  transports,
  exitOnError: false
});

// Exception and rejection handling
logger.exceptions.handle(
  new winston.transports.File({
    filename: path.join(logDir, 'exceptions.log'),
    format: productionFormat,
    maxsize: 20 * 1024 * 1024,
    maxFiles: 5
  })
);

logger.rejections.handle(
  new winston.transports.File({
    filename: path.join(logDir, 'rejections.log'),
    format: productionFormat,
    maxsize: 20 * 1024 * 1024,
    maxFiles: 5
  })
);

/**
 * Enhanced logger with structured logging capabilities
 */
class ProductionLogger {
  constructor() {
    this.correlationIdCounter = 0;
    this.performanceTimers = new Map();
    this.requestMetrics = {
      totalRequests: 0,
      errorCount: 0,
      slowRequests: 0,
      averageResponseTime: 0
    };
  }

  /**
   * Generate correlation ID for request tracking
   */
  generateCorrelationId() {
    const timestamp = Date.now().toString(36);
    const counter = (++this.correlationIdCounter).toString(36);
    const random = Math.random().toString(36).substr(2, 4);
    return `${timestamp}-${counter}-${random}`;
  }

  /**
   * Create child logger with correlation ID
   */
  child(metadata = {}) {
    const correlationId = metadata.correlationId || this.generateCorrelationId();
    return logger.child({ correlationId, ...metadata });
  }

  /**
   * Emergency: System is unusable
   */
  emergency(message, metadata = {}) {
    return logger.emergency(message, { category: 'system', ...metadata });
  }

  /**
   * Alert: Action must be taken immediately
   */
  alert(message, metadata = {}) {
    return logger.alert(message, { category: 'alert', ...metadata });
  }

  /**
   * Critical: Critical conditions
   */
  critical(message, metadata = {}) {
    return logger.critical(message, { category: 'critical', ...metadata });
  }

  /**
   * Error: Error conditions
   */
  error(message, metadata = {}) {
    return logger.error(message, { category: 'error', ...metadata });
  }

  /**
   * Warning: Warning conditions
   */
  warn(message, metadata = {}) {
    return logger.warn(message, { category: 'warning', ...metadata });
  }

  /**
   * Notice: Normal but significant condition
   */
  notice(message, metadata = {}) {
    return logger.notice(message, { category: 'notice', ...metadata });
  }

  /**
   * Info: Informational messages
   */
  info(message, metadata = {}) {
    return logger.info(message, { category: 'info', ...metadata });
  }

  /**
   * Debug: Debug-level messages
   */
  debug(message, metadata = {}) {
    return logger.debug(message, { category: 'debug', ...metadata });
  }

  /**
   * Trace: Very detailed debug information
   */
  trace(message, metadata = {}) {
    return logger.log('trace', message, { category: 'trace', ...metadata });
  }

  /**
   * HTTP Request logging
   */
  http(req, res, responseTime, metadata = {}) {
    const logData = {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      responseTime: `${responseTime}ms`,
      userAgent: req.get('User-Agent'),
      ip: req.ip || req.connection.remoteAddress,
      userId: req.user?.id,
      correlationId: req.correlationId,
      category: 'http',
      ...metadata
    };

    const level = res.statusCode >= 500 ? 'error' : 
                  res.statusCode >= 400 ? 'warn' : 'info';

    return logger.log(level, `${req.method} ${req.url} ${res.statusCode} - ${responseTime}ms`, logData);
  }

  /**
   * Database query logging
   */
  database(query, duration, params = null, metadata = {}) {
    const logData = {
      query: query.length > 200 ? query.substring(0, 200) + '...' : query,
      duration: `${duration}ms`,
      paramCount: params ? (Array.isArray(params) ? params.length : Object.keys(params).length) : 0,
      slow: duration > 1000,
      category: 'database',
      ...metadata
    };

    const level = duration > 5000 ? 'warn' : 'debug';
    return logger.log(level, `Database query executed in ${duration}ms`, logData);
  }

  /**
   * Security event logging
   */
  security(event, success, metadata = {}) {
    const logData = {
      event,
      success,
      category: 'security',
      severity: success ? 'info' : 'warn',
      ...metadata
    };

    const level = success ? 'info' : 'warn';
    return logger.log(level, `Security event: ${event}`, logData);
  }

  /**
   * Audit trail logging
   */
  audit(action, userId, resourceId, metadata = {}) {
    const logData = {
      action,
      userId,
      resourceId,
      category: 'audit',
      ...metadata
    };

    return logger.info(`Audit: ${action}`, logData);
  }

  /**
   * Performance timing utilities
   */
  startTimer(operation) {
    const timerId = `${operation}-${Date.now()}-${Math.random()}`;
    this.performanceTimers.set(timerId, {
      operation,
      startTime: process.hrtime.bigint(),
      startMemory: process.memoryUsage()
    });
    return timerId;
  }

  endTimer(timerId, metadata = {}) {
    const timer = this.performanceTimers.get(timerId);
    if (!timer) {
      return this.warn('Timer not found', { timerId });
    }

    const endTime = process.hrtime.bigint();
    const endMemory = process.memoryUsage();
    const duration = Number(endTime - timer.startTime) / 1e6; // Convert to milliseconds

    const performanceData = {
      operation: timer.operation,
      duration: `${duration.toFixed(2)}ms`,
      memoryDelta: {
        rss: endMemory.rss - timer.startMemory.rss,
        heapUsed: endMemory.heapUsed - timer.startMemory.heapUsed,
        external: endMemory.external - timer.startMemory.external
      },
      category: 'performance',
      ...metadata
    };

    this.performanceTimers.delete(timerId);

    const level = duration > 10000 ? 'warn' : 'info';
    return logger.log(level, `Performance: ${timer.operation} completed in ${duration.toFixed(2)}ms`, performanceData);
  }

  /**
   * Business logic logging
   */
  business(event, data = {}) {
    return logger.info(`Business event: ${event}`, {
      category: 'business',
      event,
      ...data
    });
  }

  /**
   * Integration logging
   */
  integration(service, operation, success, duration, metadata = {}) {
    const logData = {
      service,
      operation,
      success,
      duration: `${duration}ms`,
      category: 'integration',
      ...metadata
    };

    const level = success ? 'info' : 'error';
    return logger.log(level, `Integration: ${service} ${operation}`, logData);
  }

  /**
   * Error with context logging
   */
  errorWithContext(error, context, metadata = {}) {
    const errorData = {
      error: error.message,
      stack: error.stack,
      context,
      category: 'error',
      ...metadata
    };

    return logger.error(`Error in ${context}: ${error.message}`, errorData);
  }

  /**
   * Express middleware for request logging
   */
  middleware() {
    return (req, res, next) => {
      const startTime = Date.now();
      const correlationId = req.headers['x-correlation-id'] || this.generateCorrelationId();
      
      // Add correlation ID to request
      req.correlationId = correlationId;
      
      // Add response header
      res.setHeader('X-Correlation-ID', correlationId);
      
      // Create child logger for this request
      req.logger = this.child({ correlationId });
      
      // Log request start
      req.logger.info(`${req.method} ${req.url} started`, {
        method: req.method,
        url: req.url,
        userAgent: req.get('User-Agent'),
        ip: req.ip,
        category: 'http-start'
      });

      // Update metrics
      this.requestMetrics.totalRequests++;

      // Capture response
      const originalSend = res.send;
      res.send = function(data) {
        const responseTime = Date.now() - startTime;
        
        // Update metrics
        if (res.statusCode >= 400) {
          prodLogger.requestMetrics.errorCount++;
        }
        if (responseTime > 5000) {
          prodLogger.requestMetrics.slowRequests++;
        }
        
        // Calculate average response time
        prodLogger.requestMetrics.averageResponseTime = 
          (prodLogger.requestMetrics.averageResponseTime * (prodLogger.requestMetrics.totalRequests - 1) + responseTime) / 
          prodLogger.requestMetrics.totalRequests;

        // Log response
        prodLogger.http(req, res, responseTime);
        
        return originalSend.call(this, data);
      };

      next();
    };
  }

  /**
   * Get system metrics
   */
  getMetrics() {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    return {
      system: {
        uptime: process.uptime(),
        memory: {
          rss: memUsage.rss,
          heapUsed: memUsage.heapUsed,
          heapTotal: memUsage.heapTotal,
          external: memUsage.external
        },
        cpu: cpuUsage
      },
      requests: this.requestMetrics,
      activeTimers: this.performanceTimers.size
    };
  }

  /**
   * Health check logging
   */
  healthCheck(service, status, responseTime, metadata = {}) {
    const logData = {
      service,
      status,
      responseTime: `${responseTime}ms`,
      category: 'health-check',
      ...metadata
    };

    const level = status === 'healthy' ? 'info' : 'warn';
    return logger.log(level, `Health check: ${service} is ${status}`, logData);
  }

  /**
   * Log system shutdown
   */
  shutdown(reason = 'unknown') {
    this.info('System shutdown initiated', {
      reason,
      uptime: process.uptime(),
      category: 'system',
      metrics: this.getMetrics()
    });
    
    // Flush all transports
    return new Promise((resolve) => {
      logger.on('finish', resolve);
      logger.end();
    });
  }
}

// Create singleton instance
const prodLogger = new ProductionLogger();

// Setup logging on startup
logger.info('Production logging system initialized', {
  level: logLevel,
  environment: process.env.NODE_ENV,
  transports: transports.length,
  logDir: logDir,
  category: 'system'
});

export default prodLogger;
export { logger, ProductionLogger };