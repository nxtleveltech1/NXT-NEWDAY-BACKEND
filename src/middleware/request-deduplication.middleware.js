import crypto from 'crypto';
import cacheService from '../services/cache.service.js';

/**
 * Request Deduplication Middleware
 * Prevents duplicate requests from being processed simultaneously
 * Especially useful for preventing double-submission of forms or API calls
 */

// In-memory store for pending requests
const pendingRequests = new Map();

// Clean up old pending requests every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of pendingRequests.entries()) {
    if (now - value.timestamp > 300000) { // 5 minutes
      pendingRequests.delete(key);
    }
  }
}, 300000);

/**
 * Generate a unique key for request deduplication
 */
function generateRequestKey(req) {
  const components = [
    req.method,
    req.originalUrl,
    req.user?.sub || 'anonymous',
    JSON.stringify(req.body || {}),
    JSON.stringify(req.query || {})
  ];
  
  return crypto
    .createHash('sha256')
    .update(components.join(':'))
    .digest('hex');
}

/**
 * Request deduplication middleware
 * Prevents duplicate requests from being processed simultaneously
 */
export function requestDeduplication(options = {}) {
  const {
    methods = ['POST', 'PUT', 'PATCH', 'DELETE'], // Only dedupe modifying requests
    ttl = 5000, // Time to consider requests as duplicates (5 seconds)
    skipPaths = ['/api/health', '/api/realtime'], // Paths to skip
    useCache = true // Whether to use Redis cache for distributed deduplication
  } = options;

  return async (req, res, next) => {
    // Skip if method not in list
    if (!methods.includes(req.method)) {
      return next();
    }

    // Skip specific paths
    if (skipPaths.some(path => req.path.startsWith(path))) {
      return next();
    }

    const requestKey = generateRequestKey(req);
    const cacheKey = cacheService.generateKey('request', 'dedupe', requestKey);

    try {
      // Check if request is already being processed
      const pending = pendingRequests.get(requestKey);
      if (pending && Date.now() - pending.timestamp < ttl) {
        // Request is duplicate, wait for original to complete
        console.log(`Duplicate request detected: ${req.method} ${req.originalUrl}`);
        
        // Return the same response as the original request
        if (pending.promise) {
          try {
            const result = await pending.promise;
            return res.status(result.status).json(result.data);
          } catch (error) {
            return res.status(500).json({
              error: 'Original request failed',
              message: 'The original request encountered an error'
            });
          }
        }
        
        return res.status(429).json({
          error: 'Duplicate request',
          message: 'This request is already being processed'
        });
      }

      // Check Redis cache for distributed deduplication
      if (useCache && cacheService.isConnected) {
        const cached = await cacheService.get(cacheKey);
        if (cached) {
          console.log(`Duplicate request detected from cache: ${req.method} ${req.originalUrl}`);
          return res.status(cached.status || 200).json(cached.data);
        }
      }

      // Mark request as pending
      let resolvePromise;
      let rejectPromise;
      const promise = new Promise((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
      });

      pendingRequests.set(requestKey, {
        timestamp: Date.now(),
        promise,
        resolve: resolvePromise,
        reject: rejectPromise
      });

      // Intercept response to cache it
      const originalJson = res.json;
      const originalStatus = res.status;
      let responseData;
      let responseStatus = 200;

      res.status = function(status) {
        responseStatus = status;
        return originalStatus.call(this, status);
      };

      res.json = function(data) {
        responseData = data;
        
        // Cache the response
        const pending = pendingRequests.get(requestKey);
        if (pending) {
          pending.resolve({ status: responseStatus, data: responseData });
          
          // Store in Redis cache for distributed deduplication
          if (useCache && cacheService.isConnected) {
            cacheService.set(cacheKey, {
              status: responseStatus,
              data: responseData
            }, Math.floor(ttl / 1000)).catch(err => {
              console.error('Failed to cache dedupe response:', err);
            });
          }
        }
        
        // Clean up
        setTimeout(() => {
          pendingRequests.delete(requestKey);
        }, ttl);
        
        return originalJson.call(this, data);
      };

      // Continue with request processing
      next();

    } catch (error) {
      console.error('Request deduplication error:', error);
      // Clean up on error
      pendingRequests.delete(requestKey);
      next();
    }
  };
}

/**
 * Endpoint-specific deduplication middleware
 * Use for specific endpoints that need different deduplication settings
 */
export function deduplicateEndpoint(endpointOptions = {}) {
  return requestDeduplication({
    ...endpointOptions,
    skipPaths: [] // Don't skip any paths when used on specific endpoints
  });
}