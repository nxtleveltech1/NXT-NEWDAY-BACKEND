import { validationResult } from 'express-validator';

/**
 * Validation middleware to check express-validator results
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object  
 * @param {Function} next - Next middleware function
 */
export const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map(error => ({
        field: error.path || error.param,
        message: error.msg,
        value: error.value
      }))
    });
  }
  
  next();
};

/**
 * Async error handling wrapper
 * @param {Function} fn - Async function to wrap
 * @returns {Function} Express middleware function
 */
export const handleAsync = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Error handling middleware for route-specific errors
 * @param {Error} error - Error object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Next middleware function
 */
export const handleError = (error, req, res, next) => {
  console.error('Route Error:', error);

  // Handle specific error types
  if (error.message.includes('not found')) {
    return res.status(404).json({
      success: false,
      message: error.message
    });
  }

  if (error.message.includes('validation') || error.message.includes('invalid')) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }

  if (error.message.includes('permission') || error.message.includes('unauthorized')) {
    return res.status(403).json({
      success: false,
      message: error.message
    });
  }

  // Default server error
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
};

/**
 * Request logging middleware
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Next middleware function
 */
export const logRequest = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`);
  });
  
  next();
};

/**
 * Rate limiting middleware (simple implementation)
 * @param {number} windowMs - Time window in milliseconds
 * @param {number} maxRequests - Maximum requests per window
 * @returns {Function} Express middleware function
 */
export const rateLimit = (windowMs = 15 * 60 * 1000, maxRequests = 100) => {
  const requests = new Map();

  return (req, res, next) => {
    const clientKey = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const clientRequests = requests.get(clientKey) || [];

    // Clean old requests
    const validRequests = clientRequests.filter(time => now - time < windowMs);

    if (validRequests.length >= maxRequests) {
      return res.status(429).json({
        success: false,
        message: 'Too many requests, please try again later',
        retryAfter: Math.ceil(windowMs / 1000)
      });
    }

    validRequests.push(now);
    requests.set(clientKey, validRequests);

    next();
  };
};

export default {
  validateRequest,
  handleAsync,
  handleError,
  logRequest,
  rateLimit
};