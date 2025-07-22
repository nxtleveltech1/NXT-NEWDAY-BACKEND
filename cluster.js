import cluster from 'cluster';
import os from 'os';
import dotenv from 'dotenv';
import { closePool } from './src/config/database.js';

// Load environment variables
dotenv.config();

const numCPUs = os.cpus().length;
const clusterWorkers = process.env.CLUSTER_WORKERS || 'auto';

// Determine number of workers
let workerCount;
if (clusterWorkers === 'auto') {
  // Use number of CPU cores, but cap at 4 to prevent memory fragmentation
  workerCount = Math.min(numCPUs, 4);
} else {
  workerCount = parseInt(clusterWorkers) || 1;
}

console.log(`Starting cluster with ${workerCount} workers (CPUs: ${numCPUs})`);

if (cluster.isPrimary) {
  console.log(`Primary process ${process.pid} is running`);
  
  // Track worker memory usage
  const workerMemoryStats = new Map();
  
  // Fork workers
  for (let i = 0; i < workerCount; i++) {
    const worker = cluster.fork();
    workerMemoryStats.set(worker.id, { pid: worker.process.pid, memory: 0 });
  }

  // Monitor worker health
  const healthCheckInterval = setInterval(() => {
    for (const worker of Object.values(cluster.workers)) {
      if (worker) {
        worker.send({ type: 'health-check' });
      }
    }
  }, 30000); // Health check every 30 seconds

  // Handle worker messages (including memory reports)
  cluster.on('message', (worker, message) => {
    if (message.type === 'memory-usage') {
      workerMemoryStats.set(worker.id, {
        pid: worker.process.pid,
        memory: message.memoryPercent,
        heapUsed: message.heapUsed,
        heapTotal: message.heapTotal
      });
      
      // Log aggregated memory usage every 2 minutes
      const now = Date.now();
      if (!global.lastMemoryLog || now - global.lastMemoryLog > 120000) {
        const totalMemory = Array.from(workerMemoryStats.values())
          .reduce((sum, stats) => sum + stats.heapUsed, 0) / 1024 / 1024;
        
        console.log(`Cluster memory usage: ${Math.round(totalMemory)}MB across ${workerCount} workers`);
        global.lastMemoryLog = now;
      }
      
      // Restart worker if memory usage is critically high (>95%)
      if (message.memoryPercent > 95) {
        console.warn(`Worker ${worker.id} (PID: ${worker.process.pid}) memory critical: ${message.memoryPercent}%. Restarting...`);
        worker.kill();
      }
    }
  });

  // Replace dead workers
  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died with code ${code} and signal ${signal}`);
    workerMemoryStats.delete(worker.id);
    
    if (!worker.exitedAfterDisconnect) {
      console.log('Starting a new worker');
      const newWorker = cluster.fork();
      workerMemoryStats.set(newWorker.id, { pid: newWorker.process.pid, memory: 0 });
    }
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Primary process shutting down...');
    clearInterval(healthCheckInterval);
    
    // Disconnect all workers
    for (const worker of Object.values(cluster.workers)) {
      if (worker) {
        worker.disconnect();
      }
    }
    
    // Wait for workers to exit gracefully
    const workerExitPromises = Object.values(cluster.workers).map(worker => {
      return new Promise((resolve) => {
        if (!worker) return resolve();
        
        const timeout = setTimeout(() => {
          worker.kill('SIGKILL');
          resolve();
        }, 10000); // 10 second timeout
        
        worker.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    });
    
    await Promise.all(workerExitPromises);
    console.log('All workers shut down');
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

} else {
  // Worker process - import and run the main server
  console.log(`Worker ${process.pid} started`);
  
  // Enhanced memory monitoring for workers
  const workerMemoryInterval = setInterval(() => {
    const memUsage = process.memoryUsage();
    const memUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
    
    // Send memory stats to primary
    process.send({
      type: 'memory-usage',
      memoryPercent: memUsagePercent,
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      worker: cluster.worker.id
    });
    
    // Force garbage collection if memory usage is high
    if (memUsagePercent > 85 && global.gc) {
      console.log(`Worker ${cluster.worker.id}: High memory usage detected (${Math.round(memUsagePercent)}%), running garbage collection`);
      global.gc();
    }
  }, 120000); // Check every 2 minutes

  // Handle health checks from primary
  process.on('message', (message) => {
    if (message.type === 'health-check') {
      // Worker is healthy if it can respond
      process.send({ type: 'health-response', worker: cluster.worker.id });
    }
  });

  // Graceful worker shutdown
  const workerShutdown = async () => {
    console.log(`Worker ${cluster.worker.id} shutting down...`);
    clearInterval(workerMemoryInterval);
    
    try {
      // Close database connections
      await closePool();
    } catch (error) {
      console.error('Error closing database pool in worker:', error);
    }
    
    process.exit(0);
  };

  process.on('SIGTERM', workerShutdown);
  process.on('SIGINT', workerShutdown);
  
  // Import and start the main server
  import('./index.js');
}