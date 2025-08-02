import prodLogger from '../utils/production-logger.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Comprehensive logging middleware for NXT Backend
 * Handles request/response logging, error tracking, and security monitoring
 */

/**
 * Request logging middleware
 * Logs all incoming requests with correlation IDs and performance metrics
 */
export const requestLoggingMiddleware = (req, res, next) => {
  const startTime = Date.now();
  const correlationId = req.headers['x-correlation-id'] || uuidv4();
  
  // Add correlation ID to request and response
  req.correlationId = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);
  
  // Create child logger for this request
  req.logger = prodLogger.child({ correlationId });
  
  // Log request start
  req.logger.info(`Request started: ${req.method} ${req.url}`, {
    method: req.method,
    url: req.url,
    userAgent: req.get('User-Agent'),
    ip: req.ip || req.connection.remoteAddress,
    contentType: req.get('Content-Type'),
    contentLength: req.get('Content-Length'),
    userId: req.user?.id,
    sessionId: req.sessionID,
    category: 'http-request'
  });

  // Capture original response methods
  const originalSend = res.send;
  const originalJson = res.json;
  const originalEnd = res.end;

  // Override response methods to capture response data
  res.send = function(data) {
    logResponse(req, res, startTime, data);
    return originalSend.call(this, data);
  };

  res.json = function(data) {
    logResponse(req, res, startTime, data);
    return originalJson.call(this, data);
  };

  res.end = function(data) {
    logResponse(req, res, startTime, data);
    return originalEnd.call(this, data);
  };

  next();
};

/**
 * Log response details
 */
function logResponse(req, res, startTime, responseData) {
  const responseTime = Date.now() - startTime;
  const statusCode = res.statusCode;
  
  // Determine log level based on status code
  let level = 'info';
  if (statusCode >= 500) level = 'error';
  else if (statusCode >= 400) level = 'warn';
  else if (responseTime > 5000) level = 'warn';

  // Log response
  req.logger[level](`Request completed: ${req.method} ${req.url} ${statusCode}`, {
    method: req.method,
    url: req.url,
    statusCode,
    responseTime: `${responseTime}ms`,
    contentLength: res.get('Content-Length'),
    userId: req.user?.id,
    category: 'http-response',
    slow: responseTime > 5000,
    error: statusCode >= 400
  });

  // Log slow requests separately for monitoring
  if (responseTime > 10000) {
    req.logger.warn('Slow request detected', {
      method: req.method,
      url: req.url,
      responseTime: `${responseTime}ms`,
      category: 'performance',
      alert: true
    });
  }
}

/**
 * Error logging middleware
 * Captures and logs all application errors with context
 */
export const errorLoggingMiddleware = (error, req, res, next) => {
  const logger = req.logger || prodLogger;
  
  // Determine error severity
  const statusCode = error.statusCode || error.status || 500;
  let severity = 'medium';
  if (statusCode >= 500) severity = 'high';
  if (statusCode === 401 || statusCode === 403) severity = 'medium';
  if (error.name === 'ValidationError') severity = 'low';

  // Log error with full context
  logger.error(`Application error: ${error.message}`, {
    error: error.message,
    stack: error.stack,
    statusCode,
    method: req.method,
    url: req.url,
    userAgent: req.get('User-Agent'),
    ip: req.ip,
    userId: req.user?.id,
    body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined,
    params: JSON.stringify(req.params),
    query: JSON.stringify(req.query),
    category: 'error',
    severity,
    errorType: error.name || 'UnknownError'
  });

  next(error);
};

/**
 * Security events logging middleware
 * Monitors and logs security-related events
 */
export const securityLoggingMiddleware = (req, res, next) => {
  const logger = req.logger || prodLogger;
  
  // Check for suspicious patterns in URL
  const suspiciousPatterns = [
    /(\.\.|\/\.\.|\.\.\/)/g, // Directory traversal
    /(script|javascript|vbscript)/gi, // Script injection
    /(<|%3C).*?(script|iframe|object)/gi, // HTML injection
    /(union|select|insert|update|delete|drop)/gi, // SQL injection
    /(\||;|\&)/g // Command injection
  ];

  const url = req.url.toLowerCase();
  const userAgent = req.get('User-Agent') || '';
  
  suspiciousPatterns.forEach((pattern, index) => {
    if (pattern.test(url) || pattern.test(userAgent)) {
      logger.security('suspicious_pattern_detected', false, {
        pattern: pattern.toString(),
        url: req.url,
        userAgent,
        ip: req.ip,
        method: req.method,
        patternIndex: index
      });
    }
  });

  // Log authentication events
  if (req.url.includes('/auth') || req.url.includes('/login')) {
    res.on('finish', () => {
      const success = res.statusCode < 400;
      logger.security('authentication_attempt', success, {
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        ip: req.ip,
        userAgent,
        userId: req.user?.id
      });
    });
  }

  // Monitor for rate limiting violations
  if (req.rateLimit) {
    const { limit, remaining, reset } = req.rateLimit;
    if (remaining < limit * 0.1) { // Less than 10% remaining
      logger.security('rate_limit_warning', true, {
        limit,
        remaining,
        reset,
        ip: req.ip,
        endpoint: req.url
      });
    }
  }

  next();
};

/**
 * Database query logging middleware
 */
export const databaseLoggingMiddleware = {
  /**
   * Log database query execution
   */
  logQuery: (query, params, duration, result) => {
    const level = duration > 5000 ? 'warn' : 'debug';
    
    prodLogger[level]('Database query executed', {
      query: query.length > 500 ? query.substring(0, 500) + '...' : query,
      duration: `${duration}ms`,
      paramCount: params ? (Array.isArray(params) ? params.length : Object.keys(params).length) : 0,
      resultCount: result?.rowCount || result?.length || 0,
      slow: duration > 5000,
      category: 'database'
    });
  },

  /**
   * Log database connection events
   */
  logConnection: (event, connectionId, error = null) => {
    const level = error ? 'error' : 'info';
    
    prodLogger[level](`Database connection ${event}`, {
      event,
      connectionId,
      error: error?.message,
      category: 'database-connection'
    });
  },

  /**
   * Log transaction events
   */
  logTransaction: (event, transactionId, duration = null) => {
    prodLogger.info(`Database transaction ${event}`, {
      event,
      transactionId,
      duration: duration ? `${duration}ms` : undefined,
      category: 'database-transaction'
    });
  }
};

/**
 * Business logic logging middleware
 */
export const businessLoggingMiddleware = {
  /**
   * Log business operations
   */
  logOperation: (operation, userId, data, success = true) => {
    const level = success ? 'info' : 'warn';
    
    prodLogger[level](`Business operation: ${operation}`, {
      operation,
      userId,
      success,
      data: JSON.stringify(data),
      category: 'business'
    });
  },

  /**
   * Log compliance events
   */
  logCompliance: (rule, userId, data, violation = false) => {
    const level = violation ? 'error' : 'info';
    
    prodLogger[level](`Compliance check: ${rule}`, {
      rule,
      userId,
      violation,
      data: JSON.stringify(data),
      category: 'compliance'
    });
  }
};

/**
 * File upload logging middleware
 */
export const fileUploadLoggingMiddleware = (req, res, next) => {
  if (req.file || req.files) {
    const logger = req.logger || prodLogger;
    
    const files = req.files || [req.file];
    files.forEach(file => {
      logger.info('File upload processed', {
        filename: file.originalname,
        size: file.size,
        mimetype: file.mimetype,
        userId: req.user?.id,
        category: 'file-upload'
      });
    });
  }
  
  next();
};

/**
 * API key logging middleware
 */
export const apiKeyLoggingMiddleware = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.apikey;
  
  if (apiKey) {
    const logger = req.logger || prodLogger;
    
    logger.info('API key authentication', {
      apiKeyPrefix: apiKey.substring(0, 8) + '...',
      endpoint: req.url,
      method: req.method,
      ip: req.ip,
      category: 'api-auth'
    });
  }
  
  next();
};

/**
 * WebSocket logging utilities
 */
export const websocketLogging = {
  logConnection: (socket, event) => {
    prodLogger.info(`WebSocket ${event}`, {
      socketId: socket.id,
      ip: socket.handshake.address,
      userAgent: socket.handshake.headers['user-agent'],
      userId: socket.userId,
      category: 'websocket'
    });
  },

  logMessage: (socket, event, data) => {
    prodLogger.debug('WebSocket message', {
      socketId: socket.id,
      event,
      dataSize: JSON.stringify(data).length,
      userId: socket.userId,
      category: 'websocket-message'
    });
  },

  logError: (socket, error) => {
    prodLogger.error('WebSocket error', {
      socketId: socket.id,
      error: error.message,
      stack: error.stack,
      userId: socket.userId,
      category: 'websocket-error'
    });
  }
};

/**
 * Health check logging middleware
 */
export const healthCheckLoggingMiddleware = (req, res, next) => {
  if (req.url.includes('/health') || req.url.includes('/ping')) {
    const logger = req.logger || prodLogger;
    
    res.on('finish', () => {
      logger.debug('Health check request', {
        url: req.url,
        statusCode: res.statusCode,
        responseTime: res.getHeader('X-Response-Time'),
        category: 'health-check'
      });
    });
  }
  
  next();
};

/**
 * Create comprehensive logging middleware stack
 */
export const createLoggingMiddleware = (options = {}) => {
  const middlewares = [];
  
  // Always include request logging
  middlewares.push(requestLoggingMiddleware);
  
  // Include security logging if enabled (default: true)
  if (options.security !== false) {
    middlewares.push(securityLoggingMiddleware);
  }
  
  // Include API key logging if enabled
  if (options.apiKey) {
    middlewares.push(apiKeyLoggingMiddleware);
  }
  
  // Include file upload logging if enabled
  if (options.fileUpload) {
    middlewares.push(fileUploadLoggingMiddleware);
  }
  
  // Include health check logging if enabled
  if (options.healthCheck) {
    middlewares.push(healthCheckLoggingMiddleware);
  }
  
  return middlewares;
};

export default {
  request: requestLoggingMiddleware,
  error: errorLoggingMiddleware,
  security: securityLoggingMiddleware,
  database: databaseLoggingMiddleware,
  business: businessLoggingMiddleware,
  fileUpload: fileUploadLoggingMiddleware,
  apiKey: apiKeyLoggingMiddleware,
  websocket: websocketLogging,
  healthCheck: healthCheckLoggingMiddleware,
  create: createLoggingMiddleware
};