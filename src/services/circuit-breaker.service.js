export class CircuitBreaker {
  constructor(action, options = {}) {
    this.action = action;
    this.failureThreshold = options.failureThreshold || 3;
    this.resetTimeout = options.resetTimeout || 60000;
    this.state = 'closed';
    this.failureCount = 0;
    this.lastFailureTime = null;
  }

  async fire(...args) {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        this.state = 'half-open';
      } else {
        throw new Error('Circuit breaker is open');
      }
    }

    try {
      const result = await this.action(...args);
      if (this.state === 'half-open') {
        this.state = 'closed';
        this.failureCount = 0;
      }
      return result;
    } catch (error) {
      this.failureCount++;
      this.lastFailureTime = Date.now();
      
      if (this.failureCount >= this.failureThreshold) {
        this.state = 'open';
      }
      
      throw error;
    }
  }

  open() {
    this.state = 'open';
  }

  close() {
    this.state = 'closed';
    this.failureCount = 0;
  }
}