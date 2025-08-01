const Redis = require('ioredis');
const logger = require('./logger');

class RedisClient {
  constructor(options = {}) {
    this.options = {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      db: process.env.REDIS_DB || 0,
      keyPrefix: process.env.REDIS_PREFIX || 'analytics:',
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      ...options
    };

    this.client = null;
    this.connected = false;
    this.reconnecting = false;
    this.metrics = {
      connections: 0,
      disconnections: 0,
      commands: 0,
      errors: 0
    };

    this.setupEventHandlers();
  }

  /**
   * Connect to Redis
   */
  async connect() {
    try {
      if (this.connected) {
        return this.client;
      }

      logger.info('Connecting to Redis...', {
        host: this.options.host,
        port: this.options.port,
        db: this.options.db
      });

      this.client = new Redis(this.options);
      
      // Wait for connection to be established
      await this.client.ping();
      
      this.connected = true;
      this.metrics.connections++;
      
      logger.info('Redis connection established');
      
      return this.client;

    } catch (error) {
      this.metrics.errors++;
      logger.error('Failed to connect to Redis:', error);
      throw error;
    }
  }

  /**
   * Disconnect from Redis
   */
  async disconnect() {
    try {
      if (this.client) {
        await this.client.quit();
        this.client = null;
        this.connected = false;
        this.metrics.disconnections++;
        logger.info('Redis connection closed');
      }
    } catch (error) {
      logger.error('Error disconnecting from Redis:', error);
    }
  }

  /**
   * Setup event handlers for Redis client
   */
  setupEventHandlers() {
    // Will be set when client is created
  }

  /**
   * Initialize event handlers after client creation
   * @private
   */
  initializeEventHandlers() {
    if (!this.client) return;

    this.client.on('connect', () => {
      logger.info('Redis client connected');
      this.connected = true;
      this.reconnecting = false;
    });

    this.client.on('ready', () => {
      logger.info('Redis client ready');
    });

    this.client.on('error', (error) => {
      this.metrics.errors++;
      logger.error('Redis client error:', error);
    });

    this.client.on('close', () => {
      logger.warn('Redis connection closed');
      this.connected = false;
    });

    this.client.on('reconnecting', (time) => {
      logger.info(`Redis reconnecting in ${time}ms`);
      this.reconnecting = true;
    });

    this.client.on('end', () => {
      logger.warn('Redis connection ended');
      this.connected = false;
    });
  }

  /**
   * Ensure connection is established
   * @private
   */
  async ensureConnection() {
    if (!this.connected) {
      await this.connect();
    }
    return this.client;
  }

  /**
   * Execute Redis command with error handling
   * @private
   * @param {Function} command - Redis command function
   * @param {...any} args - Command arguments
   */
  async executeCommand(command, ...args) {
    try {
      const client = await this.ensureConnection();
      this.metrics.commands++;
      return await command.call(client, ...args);
    } catch (error) {
      this.metrics.errors++;
      logger.error('Redis command error:', error, { command: command.name, args });
      throw error;
    }
  }

  // Basic Redis operations

  /**
   * Set a key-value pair
   * @param {string} key - Key
   * @param {any} value - Value
   * @param {number} ttl - TTL in seconds (optional)
   */
  async set(key, value, ttl) {
    const serializedValue = typeof value === 'string' ? value : JSON.stringify(value);
    
    if (ttl) {
      return this.executeCommand(this.client.setex, key, ttl, serializedValue);
    } else {
      return this.executeCommand(this.client.set, key, serializedValue);
    }
  }

  /**
   * Set a key-value pair with TTL
   * @param {string} key - Key
   * @param {number} ttl - TTL in seconds
   * @param {any} value - Value
   */
  async setex(key, ttl, value) {
    return this.set(key, value, ttl);
  }

  /**
   * Get a value by key
   * @param {string} key - Key
   * @param {boolean} parse - Whether to parse JSON (default: true)
   */
  async get(key, parse = true) {
    const value = await this.executeCommand(this.client.get, key);
    
    if (value === null) {
      return null;
    }

    if (!parse) {
      return value;
    }

    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  /**
   * Delete keys
   * @param {...string} keys - Keys to delete
   */
  async del(...keys) {
    return this.executeCommand(this.client.del, ...keys);
  }

  /**
   * Check if key exists
   * @param {string} key - Key
   */
  async exists(key) {
    return this.executeCommand(this.client.exists, key);
  }

  /**
   * Set TTL for a key
   * @param {string} key - Key
   * @param {number} ttl - TTL in seconds
   */
  async expire(key, ttl) {
    return this.executeCommand(this.client.expire, key, ttl);
  }

  /**
   * Get TTL for a key
   * @param {string} key - Key
   */
  async ttl(key) {
    return this.executeCommand(this.client.ttl, key);
  }

  /**
   * Get keys matching pattern
   * @param {string} pattern - Pattern (e.g., 'analytics:*')
   */
  async keys(pattern) {
    return this.executeCommand(this.client.keys, pattern);
  }

  // Hash operations

  /**
   * Set hash field
   * @param {string} key - Hash key
   * @param {string} field - Field name
   * @param {any} value - Field value
   */
  async hset(key, field, value) {
    const serializedValue = typeof value === 'string' ? value : JSON.stringify(value);
    return this.executeCommand(this.client.hset, key, field, serializedValue);
  }

  /**
   * Get hash field
   * @param {string} key - Hash key
   * @param {string} field - Field name
   * @param {boolean} parse - Whether to parse JSON (default: true)
   */
  async hget(key, field, parse = true) {
    const value = await this.executeCommand(this.client.hget, key, field);
    
    if (value === null) {
      return null;
    }

    if (!parse) {
      return value;
    }

    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  /**
   * Get all hash fields and values
   * @param {string} key - Hash key
   * @param {boolean} parse - Whether to parse JSON values (default: true)
   */
  async hgetall(key, parse = true) {
    const hash = await this.executeCommand(this.client.hgetall, key);
    
    if (!parse) {
      return hash;
    }

    const parsedHash = {};
    for (const [field, value] of Object.entries(hash)) {
      try {
        parsedHash[field] = JSON.parse(value);
      } catch {
        parsedHash[field] = value;
      }
    }

    return parsedHash;
  }

  /**
   * Delete hash field
   * @param {string} key - Hash key
   * @param {...string} fields - Field names
   */
  async hdel(key, ...fields) {
    return this.executeCommand(this.client.hdel, key, ...fields);
  }

  /**
   * Check if hash field exists
   * @param {string} key - Hash key
   * @param {string} field - Field name
   */
  async hexists(key, field) {
    return this.executeCommand(this.client.hexists, key, field);
  }

  // List operations

  /**
   * Push to left of list
   * @param {string} key - List key
   * @param {...any} values - Values to push
   */
  async lpush(key, ...values) {
    const serializedValues = values.map(v => typeof v === 'string' ? v : JSON.stringify(v));
    return this.executeCommand(this.client.lpush, key, ...serializedValues);
  }

  /**
   * Push to right of list
   * @param {string} key - List key
   * @param {...any} values - Values to push
   */
  async rpush(key, ...values) {
    const serializedValues = values.map(v => typeof v === 'string' ? v : JSON.stringify(v));
    return this.executeCommand(this.client.rpush, key, ...serializedValues);
  }

  /**
   * Pop from left of list
   * @param {string} key - List key
   * @param {boolean} parse - Whether to parse JSON (default: true)
   */
  async lpop(key, parse = true) {
    const value = await this.executeCommand(this.client.lpop, key);
    
    if (value === null) {
      return null;
    }

    if (!parse) {
      return value;
    }

    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  /**
   * Pop from right of list
   * @param {string} key - List key
   * @param {boolean} parse - Whether to parse JSON (default: true)
   */
  async rpop(key, parse = true) {
    const value = await this.executeCommand(this.client.rpop, key);
    
    if (value === null) {
      return null;
    }

    if (!parse) {
      return value;
    }

    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  /**
   * Get list range
   * @param {string} key - List key
   * @param {number} start - Start index
   * @param {number} stop - Stop index
   * @param {boolean} parse - Whether to parse JSON (default: true)
   */
  async lrange(key, start, stop, parse = true) {
    const values = await this.executeCommand(this.client.lrange, key, start, stop);
    
    if (!parse) {
      return values;
    }

    return values.map(value => {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    });
  }

  /**
   * Get list length
   * @param {string} key - List key
   */
  async llen(key) {
    return this.executeCommand(this.client.llen, key);
  }

  // Set operations

  /**
   * Add to set
   * @param {string} key - Set key
   * @param {...any} members - Members to add
   */
  async sadd(key, ...members) {
    const serializedMembers = members.map(m => typeof m === 'string' ? m : JSON.stringify(m));
    return this.executeCommand(this.client.sadd, key, ...serializedMembers);
  }

  /**
   * Get all set members
   * @param {string} key - Set key
   * @param {boolean} parse - Whether to parse JSON (default: true)
   */
  async smembers(key, parse = true) {
    const members = await this.executeCommand(this.client.smembers, key);
    
    if (!parse) {
      return members;
    }

    return members.map(member => {
      try {
        return JSON.parse(member);
      } catch {
        return member;
      }
    });
  }

  /**
   * Remove from set
   * @param {string} key - Set key
   * @param {...any} members - Members to remove
   */
  async srem(key, ...members) {
    const serializedMembers = members.map(m => typeof m === 'string' ? m : JSON.stringify(m));
    return this.executeCommand(this.client.srem, key, ...serializedMembers);
  }

  /**
   * Check if member exists in set
   * @param {string} key - Set key
   * @param {any} member - Member to check
   */
  async sismember(key, member) {
    const serializedMember = typeof member === 'string' ? member : JSON.stringify(member);
    return this.executeCommand(this.client.sismember, key, serializedMember);
  }

  // Utility methods

  /**
   * Ping Redis server
   */
  async ping() {
    return this.executeCommand(this.client.ping);
  }

  /**
   * Flush all data
   */
  async flushall() {
    return this.executeCommand(this.client.flushall);
  }

  /**
   * Get Redis info
   */
  async info() {
    return this.executeCommand(this.client.info);
  }

  /**
   * Get client metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      connected: this.connected,
      reconnecting: this.reconnecting
    };
  }

  /**
   * Check if Redis is connected
   */
  isConnected() {
    return this.connected;
  }

  /**
   * Execute multiple commands in pipeline
   * @param {Array} commands - Array of [command, ...args] arrays
   */
  async pipeline(commands) {
    const client = await this.ensureConnection();
    const pipeline = client.pipeline();
    
    for (const [command, ...args] of commands) {
      pipeline[command](...args);
    }
    
    this.metrics.commands += commands.length;
    return pipeline.exec();
  }

  /**
   * Execute commands in transaction
   * @param {Array} commands - Array of [command, ...args] arrays
   */
  async multi(commands) {
    const client = await this.ensureConnection();
    const multi = client.multi();
    
    for (const [command, ...args] of commands) {
      multi[command](...args);
    }
    
    this.metrics.commands += commands.length;
    return multi.exec();
  }

  /**
   * Create cache key with namespace
   * @param {...string} parts - Key parts
   */
  createKey(...parts) {
    return parts.join(':');
  }

  /**
   * Analytics-specific cache methods
   */

  /**
   * Cache analytics result
   * @param {string} analysisId - Analysis ID
   * @param {Object} result - Analysis result
   * @param {number} ttl - TTL in seconds (default: 1 hour)
   */
  async cacheAnalyticsResult(analysisId, result, ttl = 3600) {
    const key = this.createKey('result', analysisId);
    return this.set(key, result, ttl);
  }

  /**
   * Get cached analytics result
   * @param {string} analysisId - Analysis ID
   */
  async getCachedAnalyticsResult(analysisId) {
    const key = this.createKey('result', analysisId);
    return this.get(key);
  }

  /**
   * Cache model predictions
   * @param {string} modelName - Model name
   * @param {string} inputHash - Hash of input data
   * @param {Object} prediction - Prediction result
   * @param {number} ttl - TTL in seconds (default: 30 minutes)
   */
  async cachePrediction(modelName, inputHash, prediction, ttl = 1800) {
    const key = this.createKey('prediction', modelName, inputHash);
    return this.set(key, prediction, ttl);
  }

  /**
   * Get cached prediction
   * @param {string} modelName - Model name
   * @param {string} inputHash - Hash of input data
   */
  async getCachedPrediction(modelName, inputHash) {
    const key = this.createKey('prediction', modelName, inputHash);
    return this.get(key);
  }

  /**
   * Store real-time metrics
   * @param {string} metric - Metric name
   * @param {Object} data - Metric data
   * @param {number} ttl - TTL in seconds (default: 5 minutes)
   */
  async storeMetrics(metric, data, ttl = 300) {
    const key = this.createKey('metrics', metric, Date.now());
    return this.set(key, data, ttl);
  }

  /**
   * Get recent metrics
   * @param {string} metric - Metric name
   * @param {number} limit - Number of recent metrics to get
   */
  async getRecentMetrics(metric, limit = 100) {
    const pattern = this.createKey('metrics', metric, '*');
    const keys = await this.keys(pattern);
    
    // Sort by timestamp (embedded in key)
    keys.sort((a, b) => {
      const timestampA = parseInt(a.split(':').pop());
      const timestampB = parseInt(b.split(':').pop());
      return timestampB - timestampA;
    });

    const recentKeys = keys.slice(0, limit);
    const metrics = [];

    for (const key of recentKeys) {
      const data = await this.get(key);
      if (data) {
        metrics.push(data);
      }
    }

    return metrics;
  }
}

module.exports = RedisClient;