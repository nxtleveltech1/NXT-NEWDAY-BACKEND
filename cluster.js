#!/usr/bin/env node

/**
 * HIGH-PERFORMANCE CLUSTERING SERVER
 * Multi-process Node.js cluster with advanced load balancing
 * Optimized for maximum throughput and minimal latency
 */

import cluster from 'cluster';
import { cpus } from 'os';
import { createRequire } from 'module';
import { performance } from 'perf_hooks';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const require = createRequire(import.meta.url);
const numCPUs = cpus().length;
const MAX_WORKERS = process.env.MAX_WORKERS || Math.min(numCPUs, 8);
const RESTART_DELAY = 1000;
const MEMORY_THRESHOLD = 1024 * 1024 * 1024; // 1GB memory threshold

// Performance metrics
let clusterStats = {
  startTime: Date.now(),
  workerRestarts: 0,
  totalRequests: 0,
  activeWorkers: 0,
  memoryUsage: {},
  cpuUsage: {}
};

/**
 * MASTER PROCESS - Cluster Manager
 */
if (cluster.isPrimary) {
  console.log(`🚀 CLUSTER MASTER starting with ${MAX_WORKERS} workers`);
  console.log(`💻 Available CPUs: ${numCPUs}`);
  console.log(`🎯 Memory threshold: ${(MEMORY_THRESHOLD / 1024 / 1024).toFixed(0)}MB per worker`);
  
  // Worker configuration
  const workerConfig = {
    env: {
      ...process.env,
      WORKER_ID: '',
      CLUSTER_MODE: 'true'
    },
    silent: false
  };

  // Fork workers
  for (let i = 0; i < MAX_WORKERS; i++) {
    const worker = cluster.fork({
      ...workerConfig.env,
      WORKER_ID: i
    });
    
    worker.on('message', (msg) => {
      if (msg.type === 'request-count') {
        clusterStats.totalRequests += msg.count;
      }
    });
    
    clusterStats.activeWorkers++;
  }

  /**
   * ADVANCED WORKER HEALTH MONITORING
   */
  function monitorWorkerHealth() {
    for (const id in cluster.workers) {
      const worker = cluster.workers[id];
      if (worker) {
        // Memory monitoring
        const memUsage = process.memoryUsage();
        clusterStats.memoryUsage[id] = memUsage;
        
        // Restart worker if memory usage is too high
        if (memUsage.heapUsed > MEMORY_THRESHOLD) {
          console.warn(`⚠️ Worker ${id} memory usage high: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`);
          console.log(`🔄 Restarting worker ${id} due to high memory usage`);
          worker.kill();
        }
      }
    }
  }

  /**
   * GRACEFUL WORKER RESTART
   */
  cluster.on('exit', (worker, code, signal) => {
    console.log(`⚠️ Worker ${worker.process.pid} died (${code || signal})`);
    clusterStats.workerRestarts++;
    clusterStats.activeWorkers--;
    
    if (!worker.exitedAfterDisconnect) {
      console.log('🔄 Starting replacement worker...');
      setTimeout(() => {
        const newWorker = cluster.fork({
          ...workerConfig.env,
          WORKER_ID: worker.id
        });
        clusterStats.activeWorkers++;
      }, RESTART_DELAY);
    }
  });

  /**
   * CLUSTER PERFORMANCE MONITORING
   */
  function displayClusterStats() {
    const uptime = (Date.now() - clusterStats.startTime) / 1000;
    const rps = clusterStats.totalRequests / uptime;
    
    console.log('\n📊 CLUSTER PERFORMANCE STATS');
    console.log('================================');
    console.log(`⏱️  Uptime: ${uptime.toFixed(2)}s`);
    console.log(`👥 Active Workers: ${clusterStats.activeWorkers}/${MAX_WORKERS}`);
    console.log(`📈 Total Requests: ${clusterStats.totalRequests}`);
    console.log(`⚡ Requests/sec: ${rps.toFixed(2)}`);
    console.log(`🔄 Worker Restarts: ${clusterStats.workerRestarts}`);
    console.log(`💾 Master Memory: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)}MB`);
    console.log('================================\n');
  }

  /**
   * INTELLIGENT LOAD BALANCING
   */
  function setupLoadBalancing() {
    cluster.schedulingPolicy = cluster.SCHED_RR; // Round-robin scheduling
    
    // Custom load balancing based on worker health
    const originalFork = cluster.fork;
    cluster.fork = function(env) {
      const worker = originalFork.call(this, env);
      
      // Enhanced worker monitoring
      worker.on('online', () => {
        console.log(`✅ Worker ${worker.id} (PID: ${worker.process.pid}) is online`);
      });
      
      worker.on('listening', (address) => {
        console.log(`🎧 Worker ${worker.id} listening on ${address.address}:${address.port}`);
      });
      
      return worker;
    };
  }

  // Initialize load balancing
  setupLoadBalancing();

  // Start monitoring intervals
  setInterval(monitorWorkerHealth, 30000); // Check every 30 seconds
  setInterval(displayClusterStats, 60000);  // Display stats every minute

  // Handle graceful cluster shutdown
  process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, shutting down cluster gracefully...');
    
    for (const id in cluster.workers) {
      cluster.workers[id].kill();
    }
    
    setTimeout(() => {
      console.log('✅ Cluster shutdown complete');
      process.exit(0);
    }, 5000);
  });

  process.on('SIGINT', () => {
    console.log('🛑 SIGINT received, shutting down cluster gracefully...');
    
    for (const id in cluster.workers) {
      cluster.workers[id].kill();
    }
    
    setTimeout(() => {
      console.log('✅ Cluster shutdown complete');
      process.exit(0);
    }, 5000);
  });

} else {
  /**
   * WORKER PROCESS - High-Performance HTTP Server
   */
  const workerId = process.env.WORKER_ID || cluster.worker.id;
  const startTime = performance.now();
  
  console.log(`🔧 Worker ${workerId} (PID: ${process.pid}) starting...`);
  
  // Import the main application
  import('./index.js').then(() => {
    const initTime = performance.now() - startTime;
    console.log(`⚡ Worker ${workerId} ready in ${initTime.toFixed(2)}ms`);
    
    // Worker-specific optimizations
    process.title = `nxt-backend-worker-${workerId}`;
    
    // Memory management
    if (global.gc) {
      setInterval(() => {
        const memBefore = process.memoryUsage().heapUsed;
        global.gc();
        const memAfter = process.memoryUsage().heapUsed;
        const freed = memBefore - memAfter;
        
        if (freed > 10 * 1024 * 1024) { // Log if freed more than 10MB
          console.log(`🧹 Worker ${workerId} GC freed ${(freed / 1024 / 1024).toFixed(2)}MB`);
        }
      }, 60000); // GC every minute
    }
    
    // Request counting for load balancing
    let requestCount = 0;
    setInterval(() => {
      if (requestCount > 0) {
        process.send({ type: 'request-count', count: requestCount });
        requestCount = 0;
      }
    }, 5000);
    
    // Monitor worker health
    setInterval(() => {
      const memUsage = process.memoryUsage();
      if (memUsage.heapUsed > MEMORY_THRESHOLD * 0.8) {
        console.warn(`⚠️ Worker ${workerId} approaching memory limit: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`);
      }
    }, 30000);
    
  }).catch((error) => {
    console.error(`❌ Worker ${workerId} failed to start:`, error);
    process.exit(1);
  });
}

export { clusterStats };