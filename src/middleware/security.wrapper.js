import {
  securityHeaders,
  advancedRateLimiting,
  progressiveSlowdown,
  sqlInjectionProtection,
  xssProtection,
  requestSizeLimit,
  requestFingerprinting
} from './security.middleware.js';

/**
 * Security middleware wrapper for easier access
 */
export const securityMiddleware = {
  helmet: () => securityHeaders,
  rateLimiter: () => advancedRateLimiting.api,
  advancedRateLimiting: advancedRateLimiting,
  slowdown: () => progressiveSlowdown,
  sqlProtection: () => sqlInjectionProtection,
  xssProtection: () => xssProtection,
  sizeLimit: requestSizeLimit,
  fingerprinting: () => requestFingerprinting
};