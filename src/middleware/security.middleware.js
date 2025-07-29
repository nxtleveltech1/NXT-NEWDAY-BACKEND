import helmet from 'helmet';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import slowDown from 'express-slow-down';
import { body, param, query, validationResult } from 'express-validator';
import crypto from 'crypto';
import { db } from '../config/database.js';
import { timeSeriesMetrics } from '../db/schema.js';

/**
 * Comprehensive Security Headers using Helmet
 */
export const securityHeaders = helmet({
  // Content Security Policy
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "wss:", "https://api.stack-auth.com"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  
  // HTTP Strict Transport Security
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  },
  
  // Additional security headers
  noSniff: true,
  frameguard: { action: 'deny' },
  xssFilter: true,
  referrerPolicy: { policy: 'same-origin' },
  
  // Hide X-Powered-By header
  hidePoweredBy: true,
  
  // Additional custom headers
  crossOriginEmbedderPolicy: false, // Allow for WebSocket connections
});

/**
 * Advanced Rate Limiting with Progressive Delays
 */
export const advancedRateLimiting = {
  // API Authentication endpoints (stricter)
  auth: rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts per window
    message: {
      error: 'Too many authentication attempts',
      retryAfter: '15 minutes',
      code: 'AUTH_RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: ipKeyGenerator,
  }),

  // File upload endpoints
  upload: rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 uploads per window
    message: {
      error: 'Too many upload requests',
      retryAfter: '15 minutes',
      code: 'UPLOAD_RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: ipKeyGenerator,
  }),

  // General API endpoints
  api: rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // 1000 requests per window
    message: {
      error: 'Too many requests',
      retryAfter: '15 minutes',
      code: 'API_RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: ipKeyGenerator,
  }),

  // Analytics endpoints (higher limit but with slowdown)
  analytics: rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200, // 200 requests per window
    message: {
      error: 'Too many analytics requests',
      retryAfter: '15 minutes',
      code: 'ANALYTICS_RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: ipKeyGenerator,
  })
};

/**
 * Progressive Slowdown for Suspicious Activity
 */
export const progressiveSlowdown = slowDown({
  windowMs: 15 * 60 * 1000, // 15 minutes
  delayAfter: 50, // Allow 50 requests per windowMs without delay
  delayMs: () => 100, // Add 100ms delay per request after delayAfter
  maxDelayMs: 5000, // Maximum delay of 5 seconds
  keyGenerator: ipKeyGenerator,
});

/**
 * Input Sanitization and Validation
 */
export const sanitizationRules = {
  // Common sanitization for text inputs
  sanitizeText: (field, options = {}) => {
    const { min = 1, max = 255, allowEmpty = false } = options;
    return body(field)
      .trim()
      .escape()
      .isLength({ min: allowEmpty ? 0 : min, max })
      .withMessage(`${field} must be between ${min}-${max} characters`);
  },

  // Email validation and sanitization
  sanitizeEmail: (field = 'email') => 
    body(field)
      .trim()
      .normalizeEmail()
      .isEmail()
      .withMessage('Valid email address required'),

  // UUID validation
  validateUUID: (field) =>
    param(field)
      .isUUID()
      .withMessage(`Invalid ${field} format`),

  // Numeric validation
  sanitizeNumber: (field, options = {}) => {
    const { min = 0, max = Number.MAX_SAFE_INTEGER, isInt = false } = options;
    const validator = isInt ? 
      body(field).isInt({ min, max }) : 
      body(field).isFloat({ min, max });
    
    return validator.withMessage(`${field} must be a ${isInt ? 'integer' : 'number'} between ${min}-${max}`);
  },

  // Boolean validation
  sanitizeBoolean: (field) =>
    body(field)
      .optional()
      .isBoolean()
      .withMessage(`${field} must be a boolean value`),

  // Date validation
  sanitizeDate: (field) =>
    body(field)
      .optional()
      .isISO8601()
      .withMessage(`${field} must be a valid ISO 8601 date`),
};

/**
 * Enhanced Validation Error Handler
 */
export const validationErrorHandler = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    // Log validation failures for security monitoring
    logSecurityEvent('VALIDATION_FAILURE', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      endpoint: req.path,
      method: req.method,
      errors: errors.array(),
      userId: req.user?.sub
    });

    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: errors.array().map(err => ({
        field: err.path || err.param,
        message: err.msg,
        value: err.value
      })),
      timestamp: new Date().toISOString()
    });
  }
  
  next();
};

/**
 * SQL Injection Prevention
 */
export const sqlInjectionProtection = (req, res, next) => {
  const suspiciousPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION)\b)/gi,
    /(\b(OR|AND)\s+\d+\s*=\s*\d+)/gi,
    /(--|#|\/\*|\*\/)/g,
    /(\bUNION\b.*\bSELECT\b)/gi,
    /(\bDROP\b.*\bTABLE\b)/gi
  ];

  const checkValue = (value, path = '') => {
    if (typeof value === 'string') {
      for (const pattern of suspiciousPatterns) {
        if (pattern.test(value)) {
          logSecurityEvent('SQL_INJECTION_ATTEMPT', {
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            endpoint: req.path,
            method: req.method,
            suspiciousValue: value,
            path,
            userId: req.user?.sub
          });
          
          return res.status(400).json({
            success: false,
            error: 'Invalid input detected',
            code: 'SECURITY_VIOLATION',
            timestamp: new Date().toISOString()
          });
        }
      }
    } else if (typeof value === 'object' && value !== null) {
      for (const [key, val] of Object.entries(value)) {
        const result = checkValue(val, `${path}.${key}`);
        if (result) return result;
      }
    }
  };

  // Check query parameters
  const queryResult = checkValue(req.query, 'query');
  if (queryResult) return queryResult;

  // Check body parameters
  const bodyResult = checkValue(req.body, 'body');
  if (bodyResult) return bodyResult;

  next();
};

/**
 * XSS Protection
 */
export const xssProtection = (req, res, next) => {
  const xssPatterns = [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    /<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi,
    /on\w+\s*=\s*["'][^"']*["']/gi,
    /javascript\s*:/gi,
    /<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi,
    /<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi
  ];

  const sanitizeValue = (value, path = '') => {
    if (typeof value === 'string') {
      for (const pattern of xssPatterns) {
        if (pattern.test(value)) {
          logSecurityEvent('XSS_ATTEMPT', {
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            endpoint: req.path,
            method: req.method,
            suspiciousValue: value,
            path,
            userId: req.user?.sub
          });
          
          return res.status(400).json({
            success: false,
            error: 'Invalid content detected',
            code: 'SECURITY_VIOLATION',
            timestamp: new Date().toISOString()
          });
        }
      }
    } else if (typeof value === 'object' && value !== null) {
      for (const [key, val] of Object.entries(value)) {
        const result = sanitizeValue(val, `${path}.${key}`);
        if (result) return result;
      }
    }
  };

  // Check all input
  const queryResult = sanitizeValue(req.query, 'query');
  if (queryResult) return queryResult;

  const bodyResult = sanitizeValue(req.body, 'body');
  if (bodyResult) return bodyResult;

  next();
};

/**
 * Request Size Limiting
 */
export const requestSizeLimit = (maxSizeBytes = 10 * 1024 * 1024) => {
  return (req, res, next) => {
    const contentLength = parseInt(req.get('Content-Length')) || 0;
    
    if (contentLength > maxSizeBytes) {
      logSecurityEvent('REQUEST_SIZE_EXCEEDED', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        endpoint: req.path,
        method: req.method,
        contentLength,
        maxAllowed: maxSizeBytes,
        userId: req.user?.sub
      });
      
      return res.status(413).json({
        success: false,
        error: 'Request too large',
        code: 'REQUEST_TOO_LARGE',
        maxSize: `${Math.round(maxSizeBytes / 1024 / 1024)}MB`,
        timestamp: new Date().toISOString()
      });
    }
    
    next();
  };
};

/**
 * Security Event Logging
 */
export const logSecurityEvent = async (eventType, details) => {
  try {
    await db.insert(timeSeriesMetrics).values({
      timestamp: new Date(),
      metricName: 'security_event',
      metricType: 'counter',
      dimension1: eventType,
      dimension2: details.endpoint || 'unknown',
      dimension3: details.ip || 'unknown',
      value: 1,
      tags: {
        ...details,
        severity: getSeverityLevel(eventType),
        detectedAt: new Date().toISOString()
      }
    });

    // Console log for immediate visibility
    console.warn(`🚨 Security Event [${eventType}]:`, details);
  } catch (error) {
    console.error('Failed to log security event:', error);
  }
};

/**
 * Get severity level for security events
 */
const getSeverityLevel = (eventType) => {
  const severityMap = {
    'SQL_INJECTION_ATTEMPT': 'HIGH',
    'XSS_ATTEMPT': 'HIGH',
    'BRUTE_FORCE_ATTEMPT': 'HIGH',
    'VALIDATION_FAILURE': 'LOW',
    'REQUEST_SIZE_EXCEEDED': 'MEDIUM',
    'SUSPICIOUS_ACTIVITY': 'MEDIUM',
    'AUTH_FAILURE': 'MEDIUM'
  };
  
  return severityMap[eventType] || 'LOW';
};

/**
 * File Upload Security
 */
export const fileUploadSecurity = {
  validateFileType: (allowedTypes = ['image/jpeg', 'image/png', 'application/pdf']) => {
    return (req, res, next) => {
      if (req.file) {
        if (!allowedTypes.includes(req.file.mimetype)) {
          logSecurityEvent('INVALID_FILE_TYPE', {
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            endpoint: req.path,
            fileName: req.file.originalname,
            mimeType: req.file.mimetype,
            allowedTypes,
            userId: req.user?.sub
          });
          
          return res.status(400).json({
            success: false,
            error: 'Invalid file type',
            code: 'INVALID_FILE_TYPE',
            allowedTypes,
            timestamp: new Date().toISOString()
          });
        }

        // Check file signature/magic bytes
        const fileBuffer = req.file.buffer;
        if (!validateFileSignature(fileBuffer, req.file.mimetype)) {
          logSecurityEvent('FILE_SIGNATURE_MISMATCH', {
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            endpoint: req.path,
            fileName: req.file.originalname,
            mimeType: req.file.mimetype,
            userId: req.user?.sub
          });
          
          return res.status(400).json({
            success: false,
            error: 'File signature does not match declared type',
            code: 'FILE_SIGNATURE_MISMATCH',
            timestamp: new Date().toISOString()
          });
        }
      }
      next();
    };
  },

  scanForMalware: () => {
    return (req, res, next) => {
      if (req.file) {
        // Basic pattern matching for suspicious content
        const suspiciousPatterns = [
          /<%[\s\S]*?%>/g, // ASP/JSP
          /<\?php[\s\S]*?\?>/g, // PHP
          /<script[\s\S]*?<\/script>/gi, // JavaScript
          /eval\s*\(/gi, // eval() calls
          /exec\s*\(/gi, // exec() calls
        ];

        const fileContent = req.file.buffer.toString('utf8', 0, Math.min(1024, req.file.buffer.length));
        
        for (const pattern of suspiciousPatterns) {
          if (pattern.test(fileContent)) {
            logSecurityEvent('MALWARE_PATTERN_DETECTED', {
              ip: req.ip,
              userAgent: req.get('User-Agent'),
              endpoint: req.path,
              fileName: req.file.originalname,
              pattern: pattern.toString(),
              userId: req.user?.sub
            });
            
            return res.status(400).json({
              success: false,
              error: 'Suspicious content detected in file',
              code: 'MALWARE_DETECTED',
              timestamp: new Date().toISOString()
            });
          }
        }
      }
      next();
    };
  }
};

/**
 * Validate file signature against MIME type
 */
const validateFileSignature = (buffer, mimeType) => {
  const signatures = {
    'image/jpeg': [0xFF, 0xD8, 0xFF],
    'image/png': [0x89, 0x50, 0x4E, 0x47],
    'application/pdf': [0x25, 0x50, 0x44, 0x46],
    'text/csv': null, // No signature
    'application/json': null, // No signature
    'application/xml': null, // No signature
    'text/xml': null, // No signature
  };

  const signature = signatures[mimeType];
  if (!signature) return true; // No signature to check

  if (buffer.length < signature.length) return false;

  for (let i = 0; i < signature.length; i++) {
    if (buffer[i] !== signature[i]) {
      return false;
    }
  }

  return true;
};

/**
 * Request Fingerprinting for Anomaly Detection
 */
export const requestFingerprinting = (req, res, next) => {
  const fingerprint = crypto.createHash('sha256')
    .update(`${req.ip}:${req.get('User-Agent')}:${req.get('Accept')}:${req.get('Accept-Language')}`)
    .digest('hex')
    .substring(0, 16);

  req.fingerprint = fingerprint;
  
  // Track request patterns
  setImmediate(() => {
    logSecurityEvent('REQUEST_FINGERPRINT', {
      ip: req.ip,
      fingerprint,
      userAgent: req.get('User-Agent'),
      endpoint: req.path,
      method: req.method,
      userId: req.user?.sub
    });
  });

  next();
};

export default {
  securityHeaders,
  advancedRateLimiting,
  progressiveSlowdown,
  sanitizationRules,
  validationErrorHandler,
  sqlInjectionProtection,
  xssProtection,
  requestSizeLimit,
  fileUploadSecurity,
  requestFingerprinting,
  logSecurityEvent
};