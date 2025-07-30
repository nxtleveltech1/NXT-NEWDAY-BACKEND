import {
  performanceMonitoring,
  compressionMiddleware,
  responseCaching,
  requestTimeout,
  memoryMonitoring,
  queryOptimization,
  performanceErrorHandler
} from './performance.middleware.js';

/**
 * Performance middleware wrapper for easier access
 */
export const performanceMiddleware = {
  compression: () => compressionMiddleware,
  responseCache: () => responseCaching,
  responseTime: () => performanceMonitoring,
  timeout: requestTimeout,
  memory: memoryMonitoring,
  queryOptimization: queryOptimization,
  errorHandler: performanceErrorHandler
};