/**
 * Performance Best Practices Implementation
 * Production-grade optimizations and patterns
 */

import cluster from 'cluster';
import os from 'os';
import { promisify } from 'util';
import { gzip, brotliCompress } from 'zlib';
import LRU from 'lru-cache';

const gzipAsync = promisify(gzip);
const brotliAsync = promisify(brotliCompress);

/**
 * Connection pooling manager
 */
class ConnectionPoolManager {
  constructor() {
    this.pools = new Map();
    this.defaultConfig = {
      min: 2,
      max: 10,
      acquireTimeoutMillis: 30000,
      createTimeoutMillis: 30000,
      destroyTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      reapIntervalMillis: 1000,
      createRetryIntervalMillis: 200,
      propagateCreateError: false
    };
  }

  createPool(name, factory, config = {}) {
    const poolConfig = { ...this.defaultConfig, ...config };
    
    const pool = {
      name,
      factory,
      config: poolConfig,
      available: [],
      inUse: new Set(),
      creating: 0,
      destroyed: 0,
      stats: {
        created: 0,
        acquired: 0,
        released: 0,
        timeouts: 0,
        errors: 0
      }
    };

    this.pools.set(name, pool);
    this.initializePool(pool);
    
    return pool;
  }

  async initializePool(pool) {
    // Create minimum connections
    for (let i = 0; i < pool.config.min; i++) {
      try {
        await this.createConnection(pool);
      } catch (error) {
        console.error(`Error initializing pool ${pool.name}:`, error.message);
      }
    }
  }

  async createConnection(pool) {
    if (pool.creating + pool.available.length + pool.inUse.size >= pool.config.max) {
      return null;
    }

    pool.creating++;
    
    try {
      const connection = await pool.factory.create();
      pool.stats.created++;
      pool.available.push({
        connection,
        createdAt: Date.now(),
        lastUsed: Date.now()
      });
      return connection;
    } catch (error) {
      pool.stats.errors++;
      throw error;
    } finally {
      pool.creating--;
    }
  }

  async acquire(poolName) {
    const pool = this.pools.get(poolName);
    if (!pool) {
      throw new Error(`Pool ${poolName} not found`);
    }

    // Try to get from available connections
    if (pool.available.length > 0) {
      const wrapper = pool.available.shift();
      pool.inUse.add(wrapper);
      pool.stats.acquired++;
      wrapper.lastUsed = Date.now();
      return wrapper.connection;
    }

    // Create new connection if possible
    if (pool.creating + pool.available.length + pool.inUse.size < pool.config.max) {
      try {
        const connection = await this.createConnection(pool);
        if (connection) {
          const wrapper = pool.available.shift();
          pool.inUse.add(wrapper);
          pool.stats.acquired++;
          return wrapper.connection;
        }
      } catch (error) {
        console.error(`Error creating connection for pool ${poolName}:`, error.message);
      }
    }

    // Wait for connection to become available
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pool.stats.timeouts++;
        reject(new Error(`Connection acquisition timeout for pool ${poolName}`));
      }, pool.config.acquireTimeoutMillis);

      const checkAvailable = () => {
        if (pool.available.length > 0) {
          clearTimeout(timeout);
          const wrapper = pool.available.shift();
          pool.inUse.add(wrapper);
          pool.stats.acquired++;
          wrapper.lastUsed = Date.now();
          resolve(wrapper.connection);
        } else {
          setTimeout(checkAvailable, 100);
        }
      };

      checkAvailable();
    });
  }

  release(poolName, connection) {
    const pool = this.pools.get(poolName);
    if (!pool) {
      return false;
    }

    // Find connection in inUse set
    let wrapper = null;
    for (const w of pool.inUse) {
      if (w.connection === connection) {
        wrapper = w;
        break;
      }
    }

    if (!wrapper) {
      return false;
    }

    pool.inUse.delete(wrapper);
    
    // Validate connection before returning to pool
    if (pool.factory.validate && !pool.factory.validate(connection)) {
      this.destroyConnection(pool, wrapper);
      return true;
    }

    wrapper.lastUsed = Date.now();
    pool.available.push(wrapper);
    pool.stats.released++;
    
    return true;
  }

  async destroyConnection(pool, wrapper) {
    try {
      if (pool.factory.destroy) {
        await pool.factory.destroy(wrapper.connection);
      }
      pool.destroyed++;
    } catch (error) {
      console.error(`Error destroying connection in pool ${pool.name}:`, error.message);
    }
  }

  getPoolStats(poolName) {
    const pool = this.pools.get(poolName);
    if (!pool) {
      return null;
    }

    return {
      name: poolName,
      available: pool.available.length,
      inUse: pool.inUse.size,
      creating: pool.creating,
      destroyed: pool.destroyed,
      total: pool.available.length + pool.inUse.size + pool.creating,
      config: pool.config,
      stats: { ...pool.stats }
    };
  }
}

/**
 * Response compression utilities
 */
class ResponseCompression {
  constructor() {
    this.cache = new LRU({
      max: 1000,
      maxAge: 1000 * 60 * 5 // 5 minutes
    });
  }

  shouldCompress(req, res) {
    // Don't compress if already compressed
    if (res.getHeader('content-encoding')) {
      return false;
    }

    // Check content type
    const contentType = res.getHeader('content-type') || '';
    const compressibleTypes = [
      'text/',
      'application/json',
      'application/javascript',
      'application/xml',
      'application/rss+xml',
      'image/svg+xml'
    ];

    return compressibleTypes.some(type => contentType.includes(type));
  }

  getCompressionAlgorithm(req) {
    const acceptEncoding = req.headers['accept-encoding'] || '';
    
    if (acceptEncoding.includes('br')) {
      return 'brotli';
    } else if (acceptEncoding.includes('gzip')) {
      return 'gzip';
    }
    
    return null;
  }

  async compress(data, algorithm) {
    const cacheKey = `${algorithm}:${Buffer.isBuffer(data) ? data.toString('base64').slice(0, 50) : data.slice(0, 50)}`;
    
    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    let compressed;
    
    if (algorithm === 'brotli') {
      compressed = await brotliAsync(data);
    } else if (algorithm === 'gzip') {
      compressed = await gzipAsync(data);
    } else {
      return data;
    }

    // Cache compressed result
    this.cache.set(cacheKey, compressed);
    
    return compressed;
  }

  middleware() {
    return async (req, res, next) => {
      if (!this.shouldCompress(req, res)) {
        return next();
      }

      const algorithm = this.getCompressionAlgorithm(req);
      if (!algorithm) {
        return next();
      }

      // Override res.send to compress response
      const originalSend = res.send;
      
      res.send = async function(data) {
        try {
          const compressed = await this.compress(data, algorithm);
          
          res.setHeader('content-encoding', algorithm === 'brotli' ? 'br' : algorithm);
          res.setHeader('vary', 'accept-encoding');
          res.setHeader('content-length', compressed.length);
          
          return originalSend.call(this, compressed);
        } catch (error) {
          console.error('Compression error:', error);
          return originalSend.call(this, data);
        }
      }.bind(this);

      next();
    };
  }
}

/**
 * Request batching for efficient processing
 */
class RequestBatcher {
  constructor(options = {}) {
    this.maxBatchSize = options.maxBatchSize || 10;
    this.maxWaitTime = options.maxWaitTime || 100; // ms
    this.batches = new Map();
  }

  batch(key, request) {
    return new Promise((resolve, reject) => {
      if (!this.batches.has(key)) {
        this.batches.set(key, {
          requests: [],
          timer: null
        });
      }

      const batch = this.batches.get(key);
      batch.requests.push({ request, resolve, reject });

      // Process batch if it's full
      if (batch.requests.length >= this.maxBatchSize) {
        this.processBatch(key);
      } else if (!batch.timer) {
        // Set timer for automatic processing
        batch.timer = setTimeout(() => {
          this.processBatch(key);
        }, this.maxWaitTime);
      }
    });
  }

  async processBatch(key) {
    const batch = this.batches.get(key);
    if (!batch || batch.requests.length === 0) {
      return;
    }

    // Clear timer
    if (batch.timer) {
      clearTimeout(batch.timer);
    }

    // Remove batch from map
    this.batches.delete(key);

    // Extract requests and resolvers
    const requests = batch.requests.map(item => item.request);
    const resolvers = batch.requests.map(item => ({ resolve: item.resolve, reject: item.reject }));

    try {
      // Process batch (override this method in subclasses)
      const results = await this.processBatchRequests(key, requests);
      
      // Resolve individual requests
      results.forEach((result, index) => {
        if (result.success) {
          resolvers[index].resolve(result.data);
        } else {
          resolvers[index].reject(new Error(result.error));
        }
      });
    } catch (error) {
      // Reject all requests in batch
      resolvers.forEach(resolver => {
        resolver.reject(error);
      });
    }
  }

  async processBatchRequests(key, requests) {
    // Override this method in subclasses
    throw new Error('processBatchRequests must be implemented');
  }
}

/**
 * Database query batcher
 */
class DatabaseQueryBatcher extends RequestBatcher {
  constructor(db, options = {}) {
    super(options);
    this.db = db;
  }

  async processBatchRequests(key, queries) {
    // Group similar queries
    const grouped = this.groupQueries(queries);
    const results = [];

    for (const group of grouped) {
      try {
        const groupResults = await this.executeQueryGroup(group);
        results.push(...groupResults);
      } catch (error) {
        // Add error result for each query in the group
        group.forEach(() => {
          results.push({ success: false, error: error.message });
        });
      }
    }

    return results;
  }

  groupQueries(queries) {
    const groups = new Map();
    
    queries.forEach((query, index) => {
      const signature = this.getQuerySignature(query);
      
      if (!groups.has(signature)) {
        groups.set(signature, []);
      }
      
      groups.get(signature).push({ query, index });
    });

    return Array.from(groups.values());
  }

  getQuerySignature(query) {
    // Create a signature based on query type and structure
    return `${query.method}_${query.table}_${Object.keys(query.conditions || {}).sort().join('_')}`;
  }

  async executeQueryGroup(group) {
    // Combine similar queries into a single database call
    if (group.length === 1) {
      const result = await this.executeSingleQuery(group[0].query);
      return [{ success: true, data: result }];
    }

    // For multiple similar queries, use batch operations
    return await this.executeBatchQueries(group.map(item => item.query));
  }

  async executeSingleQuery(query) {
    // Execute single query
    return await this.db.execute(query);
  }

  async executeBatchQueries(queries) {
    // Execute multiple queries in a transaction
    return await this.db.transaction(async (tx) => {
      const results = [];
      
      for (const query of queries) {
        try {
          const result = await tx.execute(query);
          results.push({ success: true, data: result });
        } catch (error) {
          results.push({ success: false, error: error.message });
        }
      }
      
      return results;
    });
  }
}

/**
 * Cluster management for multi-core scaling
 */
class ClusterManager {
  constructor(options = {}) {
    this.workerCount = options.workerCount || os.cpus().length;
    this.restartDelay = options.restartDelay || 1000;
    this.maxRestarts = options.maxRestarts || 5;
    this.workers = new Map();
  }

  start(appFactory) {
    if (cluster.isMaster) {
      console.log(`🚀 Master process ${process.pid} starting ${this.workerCount} workers`);
      
      // Fork workers
      for (let i = 0; i < this.workerCount; i++) {
        this.forkWorker();
      }

      // Handle worker events
      cluster.on('exit', (worker, code, signal) => {
        console.log(`Worker ${worker.process.pid} died (${signal || code})`);
        this.handleWorkerExit(worker);
      });

      // Graceful shutdown
      process.on('SIGTERM', () => this.gracefulShutdown());
      process.on('SIGINT', () => this.gracefulShutdown());
      
    } else {
      // Worker process
      console.log(`Worker ${process.pid} started`);
      appFactory();
    }
  }

  forkWorker() {
    const worker = cluster.fork();
    
    this.workers.set(worker.id, {
      worker,
      restarts: 0,
      startTime: Date.now()
    });

    return worker;
  }

  handleWorkerExit(worker) {
    const workerInfo = this.workers.get(worker.id);
    
    if (workerInfo) {
      workerInfo.restarts++;
      
      if (workerInfo.restarts <= this.maxRestarts) {
        console.log(`Restarting worker ${worker.id} (attempt ${workerInfo.restarts})`);
        
        setTimeout(() => {
          this.forkWorker();
        }, this.restartDelay);
      } else {
        console.error(`Worker ${worker.id} exceeded max restarts (${this.maxRestarts})`);
      }
      
      this.workers.delete(worker.id);
    }
  }

  gracefulShutdown() {
    console.log('🛑 Graceful shutdown initiated');
    
    const workers = Object.values(cluster.workers);
    let remaining = workers.length;

    if (remaining === 0) {
      process.exit(0);
    }

    // Send shutdown signal to all workers
    workers.forEach(worker => {
      worker.send('shutdown');
      
      worker.on('disconnect', () => {
        remaining--;
        if (remaining === 0) {
          console.log('✅ All workers shut down gracefully');
          process.exit(0);
        }
      });
    });

    // Force shutdown after timeout
    setTimeout(() => {
      console.log('⚠️  Force killing remaining workers');
      workers.forEach(worker => {
        if (!worker.isDead()) {
          worker.kill();
        }
      });
      process.exit(1);
    }, 10000);
  }

  getStats() {
    return {
      masterPid: process.pid,
      workerCount: Object.keys(cluster.workers).length,
      workers: Array.from(this.workers.values()).map(info => ({
        id: info.worker.id,
        pid: info.worker.process.pid,
        restarts: info.restarts,
        uptime: Date.now() - info.startTime,
        state: info.worker.state
      }))
    };
  }
}

/**
 * Health check manager
 */
class HealthCheckManager {
  constructor() {
    this.checks = new Map();
    this.cache = new LRU({
      max: 100,
      maxAge: 1000 * 30 // 30 seconds
    });
  }

  registerCheck(name, checkFn, options = {}) {
    this.checks.set(name, {
      name,
      checkFn,
      timeout: options.timeout || 5000,
      critical: options.critical || false,
      interval: options.interval || 60000,
      lastRun: null,
      lastResult: null
    });
  }

  async runCheck(name) {
    const check = this.checks.get(name);
    if (!check) {
      throw new Error(`Health check '${name}' not found`);
    }

    const cacheKey = `health_${name}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached) {
      return cached;
    }

    const startTime = Date.now();
    
    try {
      const result = await Promise.race([
        check.checkFn(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Health check timeout')), check.timeout)
        )
      ]);

      const checkResult = {
        name,
        status: 'healthy',
        message: result.message || 'OK',
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        details: result.details || {}
      };

      check.lastRun = Date.now();
      check.lastResult = checkResult;
      
      this.cache.set(cacheKey, checkResult);
      return checkResult;
      
    } catch (error) {
      const checkResult = {
        name,
        status: 'unhealthy',
        message: error.message,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        critical: check.critical
      };

      check.lastRun = Date.now();
      check.lastResult = checkResult;
      
      return checkResult;
    }
  }

  async runAllChecks() {
    const results = await Promise.allSettled(
      Array.from(this.checks.keys()).map(name => this.runCheck(name))
    );

    const healthResults = results.map((result, index) => {
      const checkName = Array.from(this.checks.keys())[index];
      
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          name: checkName,
          status: 'unhealthy',
          message: result.reason.message,
          critical: this.checks.get(checkName).critical
        };
      }
    });

    const overallStatus = healthResults.some(r => r.status === 'unhealthy' && r.critical) 
      ? 'critical' 
      : healthResults.some(r => r.status === 'unhealthy') 
        ? 'degraded' 
        : 'healthy';

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      checks: healthResults,
      summary: {
        total: healthResults.length,
        healthy: healthResults.filter(r => r.status === 'healthy').length,
        unhealthy: healthResults.filter(r => r.status === 'unhealthy').length,
        critical: healthResults.filter(r => r.status === 'unhealthy' && r.critical).length
      }
    };
  }
}

// Singleton instances
const connectionPoolManager = new ConnectionPoolManager();
const responseCompression = new ResponseCompression();
const healthCheckManager = new HealthCheckManager();

export {
  ConnectionPoolManager,
  ResponseCompression,
  RequestBatcher,
  DatabaseQueryBatcher,
  ClusterManager,
  HealthCheckManager,
  connectionPoolManager,
  responseCompression,
  healthCheckManager
};

export default {
  ConnectionPoolManager,
  ResponseCompression,
  RequestBatcher,
  DatabaseQueryBatcher,
  ClusterManager,
  HealthCheckManager,
  connectionPoolManager,
  responseCompression,
  healthCheckManager
};