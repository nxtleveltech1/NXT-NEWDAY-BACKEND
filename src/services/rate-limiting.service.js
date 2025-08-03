/**
 * Lightweight stub for rate limiting used only in tests or when the
 * full implementation is not available. The real implementation should
 * enforce per-operation limits against Redis or another store.
 *
 * This stub simply calls the delegate and resolves. Production runtime
 * can replace this file with a proper implementation.
 */

export const rateLimitOperation = async (fn, ...args) => fn(...args);

/**
 * Convenience wrapper used by tests that expect rateLimitedInsert()
 * signature (metricName, value)
 */
export const rateLimitedInsert = async (...args) => {
  return { success: true, data: { args } };
};