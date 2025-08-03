export function validateMetricData(data) {
  const errors = [];
  
  if (!data.name || typeof data.name !== 'string') {
    errors.push('Metric name is required and must be a string');
  }
  
  if (typeof data.value === 'undefined') {
    errors.push('Metric value is required');
  }
  
  if (!data.timestamp || !(data.timestamp instanceof Date)) {
    errors.push('Valid timestamp is required');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

export function sanitizeEventData(data) {
  if (!data || typeof data !== 'object') {
    return data;
  }
  
  const sanitized = { ...data };
  
  // Remove any potential XSS vectors
  Object.keys(sanitized).forEach(key => {
    if (typeof sanitized[key] === 'string') {
      sanitized[key] = sanitized[key]
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+\s*=/gi, '');
    }
  });
  
  return sanitized;
}

export function validateEventData(data) {
  const errors = [];
  
  if (!data.eventType || typeof data.eventType !== 'string') {
    errors.push('Event type is required and must be a string');
  }
  
  if (!data.timestamp || !(data.timestamp instanceof Date)) {
    errors.push('Valid timestamp is required');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}