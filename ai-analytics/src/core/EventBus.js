const EventEmitter = require('events');
const logger = require('../utils/logger');

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100); // Increase max listeners for analytics use case
    this.eventHistory = [];
    this.maxHistorySize = 1000;
    this.subscribers = new Map();
    this.eventMetrics = new Map();
    
    this.setupGlobalErrorHandling();
  }

  /**
   * Enhanced emit with metrics and history tracking
   * @param {string} eventName - Event name
   * @param {...any} args - Event arguments
   */
  emit(eventName, ...args) {
    const startTime = Date.now();
    
    try {
      // Track event metrics
      this.updateEventMetrics(eventName);
      
      // Add to event history
      this.addToHistory(eventName, args);
      
      // Emit the event
      const result = super.emit(eventName, ...args);
      
      // Log debug info
      const duration = Date.now() - startTime;
      logger.debug(`Event emitted: ${eventName}`, {
        duration,
        listenerCount: this.listenerCount(eventName),
        payload: this.sanitizePayload(args)
      });
      
      return result;
    } catch (error) {
      logger.error(`Error emitting event ${eventName}:`, error);
      this.emit('error', error, eventName, args);
      return false;
    }
  }

  /**
   * Enhanced on with subscriber tracking
   * @param {string} eventName - Event name
   * @param {Function} listener - Event listener
   */
  on(eventName, listener) {
    const subscriberId = this.generateSubscriberId();
    
    // Track subscriber
    if (!this.subscribers.has(eventName)) {
      this.subscribers.set(eventName, new Set());
    }
    this.subscribers.get(eventName).add({
      id: subscriberId,
      listener,
      registeredAt: new Date()
    });
    
    // Wrap listener for error handling
    const wrappedListener = (...args) => {
      try {
        return listener(...args);
      } catch (error) {
        logger.error(`Error in event listener for ${eventName}:`, error);
        this.emit('listener:error', error, eventName, subscriberId);
      }
    };
    
    super.on(eventName, wrappedListener);
    
    logger.debug(`Event listener registered: ${eventName}`, {
      subscriberId,
      totalListeners: this.listenerCount(eventName)
    });
    
    return subscriberId;
  }

  /**
   * Enhanced once with subscriber tracking
   * @param {string} eventName - Event name
   * @param {Function} listener - Event listener
   */
  once(eventName, listener) {
    const subscriberId = this.generateSubscriberId();
    
    const wrappedListener = (...args) => {
      try {
        // Remove from subscribers tracking
        if (this.subscribers.has(eventName)) {
          const subscribers = this.subscribers.get(eventName);
          for (const subscriber of subscribers) {
            if (subscriber.id === subscriberId) {
              subscribers.delete(subscriber);
              break;
            }
          }
        }
        
        return listener(...args);
      } catch (error) {
        logger.error(`Error in once event listener for ${eventName}:`, error);
        this.emit('listener:error', error, eventName, subscriberId);
      }
    };
    
    super.once(eventName, wrappedListener);
    
    return subscriberId;
  }

  /**
   * Remove specific subscriber by ID
   * @param {string} eventName - Event name
   * @param {string} subscriberId - Subscriber ID
   */
  removeSubscriber(eventName, subscriberId) {
    if (!this.subscribers.has(eventName)) {
      return false;
    }
    
    const subscribers = this.subscribers.get(eventName);
    for (const subscriber of subscribers) {
      if (subscriber.id === subscriberId) {
        this.removeListener(eventName, subscriber.listener);
        subscribers.delete(subscriber);
        logger.debug(`Subscriber removed: ${eventName}`, { subscriberId });
        return true;
      }
    }
    
    return false;
  }

  /**
   * Get event metrics
   */
  getEventMetrics() {
    const metrics = {
      totalEvents: Array.from(this.eventMetrics.values()).reduce((sum, count) => sum + count, 0),
      uniqueEvents: this.eventMetrics.size,
      eventBreakdown: Object.fromEntries(this.eventMetrics),
      totalSubscribers: Array.from(this.subscribers.values()).reduce((sum, subs) => sum + subs.size, 0),
      subscriberBreakdown: {}
    };
    
    for (const [eventName, subscribers] of this.subscribers.entries()) {
      metrics.subscriberBreakdown[eventName] = subscribers.size;
    }
    
    return metrics;
  }

  /**
   * Get event history
   * @param {number} limit - Maximum number of events to return
   * @param {string} eventName - Filter by event name
   */
  getEventHistory(limit = 50, eventName = null) {
    let history = [...this.eventHistory];
    
    if (eventName) {
      history = history.filter(event => event.name === eventName);
    }
    
    return history.slice(-limit);
  }

  /**
   * Clear event history
   */
  clearEventHistory() {
    this.eventHistory = [];
    logger.debug('Event history cleared');
  }

  /**
   * Get active subscribers
   */
  getActiveSubscribers() {
    const activeSubscribers = {};
    
    for (const [eventName, subscribers] of this.subscribers.entries()) {
      activeSubscribers[eventName] = Array.from(subscribers).map(sub => ({
        id: sub.id,
        registeredAt: sub.registeredAt
      }));
    }
    
    return activeSubscribers;
  }

  /**
   * Bulk emit events
   * @param {Array} events - Array of {name, args} objects
   */
  bulkEmit(events) {
    const results = [];
    
    for (const event of events) {
      try {
        const result = this.emit(event.name, ...(event.args || []));
        results.push({ name: event.name, success: result });
      } catch (error) {
        results.push({ name: event.name, success: false, error: error.message });
      }
    }
    
    return results;
  }

  /**
   * Create event namespace
   * @param {string} namespace - Namespace prefix
   */
  createNamespace(namespace) {
    return {
      emit: (eventName, ...args) => this.emit(`${namespace}:${eventName}`, ...args),
      on: (eventName, listener) => this.on(`${namespace}:${eventName}`, listener),
      once: (eventName, listener) => this.once(`${namespace}:${eventName}`, listener),
      off: (eventName, listener) => this.removeListener(`${namespace}:${eventName}`, listener)
    };
  }

  /**
   * Wait for specific event with timeout
   * @param {string} eventName - Event to wait for
   * @param {number} timeout - Timeout in milliseconds
   */
  waitForEvent(eventName, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeListener(eventName, listener);
        reject(new Error(`Timeout waiting for event: ${eventName}`));
      }, timeout);
      
      const listener = (...args) => {
        clearTimeout(timer);
        resolve(args);
      };
      
      this.once(eventName, listener);
    });
  }

  /**
   * Setup global error handling
   * @private
   */
  setupGlobalErrorHandling() {
    this.on('error', (error, context) => {
      logger.error('EventBus error:', error, { context });
    });
    
    this.on('listener:error', (error, eventName, subscriberId) => {
      logger.error(`Listener error for event ${eventName}:`, error, { subscriberId });
    });
  }

  /**
   * Update event metrics
   * @private
   */
  updateEventMetrics(eventName) {
    const currentCount = this.eventMetrics.get(eventName) || 0;
    this.eventMetrics.set(eventName, currentCount + 1);
  }

  /**
   * Add event to history
   * @private
   */
  addToHistory(eventName, args) {
    this.eventHistory.push({
      name: eventName,
      timestamp: new Date(),
      payload: this.sanitizePayload(args)
    });
    
    // Trim history if too large
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory = this.eventHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * Sanitize payload for logging
   * @private
   */
  sanitizePayload(args) {
    try {
      return JSON.parse(JSON.stringify(args, (key, value) => {
        // Remove sensitive data
        if (typeof key === 'string' && key.toLowerCase().includes('password')) {
          return '[REDACTED]';
        }
        if (typeof key === 'string' && key.toLowerCase().includes('token')) {
          return '[REDACTED]';
        }
        if (typeof key === 'string' && key.toLowerCase().includes('secret')) {
          return '[REDACTED]';
        }
        return value;
      }));
    } catch (error) {
      return '[UNPARSEABLE]';
    }
  }

  /**
   * Generate unique subscriber ID
   * @private
   */
  generateSubscriberId() {
    return `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get comprehensive health status
   */
  getHealth() {
    return {
      status: 'healthy',
      metrics: this.getEventMetrics(),
      memoryUsage: {
        eventHistory: this.eventHistory.length,
        maxHistorySize: this.maxHistorySize,
        subscribersCount: this.subscribers.size
      },
      uptime: process.uptime()
    };
  }
}

module.exports = EventBus;