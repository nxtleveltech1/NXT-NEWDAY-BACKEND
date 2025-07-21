/**
 * Port Manager Utility
 * Handles port availability checking, conflict resolution, and graceful fallback
 */

import net from 'net';

export class PortManager {
  constructor() {
    this.usedPorts = new Set();
    this.reservedPorts = new Set([22, 23, 25, 53, 80, 135, 139, 443, 445, 993, 995]);
  }

  /**
   * Check if a port is available
   * @param {number} port - Port number to check
   * @returns {Promise<boolean>} - True if port is available
   */
  async isPortAvailable(port) {
    return new Promise((resolve) => {
      if (this.reservedPorts.has(port) || this.usedPorts.has(port)) {
        resolve(false);
        return;
      }

      const server = net.createServer();
      
      server.listen(port, () => {
        server.once('close', () => {
          resolve(true);
        });
        server.close();
      });
      
      server.on('error', () => {
        resolve(false);
      });
    });
  }

  /**
   * Find an available port starting from a preferred port
   * @param {number} preferredPort - The preferred port to start checking from
   * @param {number} maxAttempts - Maximum number of ports to check
   * @returns {Promise<number|null>} - Available port number or null if none found
   */
  async findAvailablePort(preferredPort, maxAttempts = 100) {
    let currentPort = preferredPort;
    let attempts = 0;

    while (attempts < maxAttempts) {
      if (await this.isPortAvailable(currentPort)) {
        this.usedPorts.add(currentPort);
        return currentPort;
      }
      currentPort++;
      attempts++;
    }

    return null;
  }

  /**
   * Reserve a port for use
   * @param {number} port - Port to reserve
   */
  reservePort(port) {
    this.usedPorts.add(port);
  }

  /**
   * Release a reserved port
   * @param {number} port - Port to release
   */
  releasePort(port) {
    this.usedPorts.delete(port);
  }

  /**
   * Get all currently used ports
   * @returns {Array<number>} - Array of used port numbers
   */
  getUsedPorts() {
    return Array.from(this.usedPorts);
  }

  /**
   * Check if multiple processes are trying to use the same port
   * @param {number} port - Port to check for conflicts
   * @returns {Promise<Array<Object>>} - Array of process information using the port
   */
  async getPortConflicts(port) {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      // Windows command to find processes using a specific port
      const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
      const lines = stdout.split('\n').filter(line => line.trim());
      
      const conflicts = [];
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5 && parts[1].includes(`:${port}`)) {
          const pid = parts[parts.length - 1];
          try {
            const { stdout: processInfo } = await execAsync(`wmic process where ProcessId=${pid} get Name,ProcessId,CommandLine /format:csv`);
            const processLines = processInfo.split('\n').filter(l => l.trim() && !l.startsWith('Node'));
            if (processLines.length > 0) {
              const processData = processLines[0].split(',');
              conflicts.push({
                pid: parseInt(pid),
                name: processData[1] || 'Unknown',
                commandLine: processData[0] || 'Unknown',
                localAddress: parts[1]
              });
            }
          } catch (error) {
            conflicts.push({
              pid: parseInt(pid),
              name: 'Unknown',
              commandLine: 'Unknown',
              localAddress: parts[1]
            });
          }
        }
      }
      
      return conflicts;
    } catch (error) {
      console.error('Error checking port conflicts:', error);
      return [];
    }
  }

  /**
   * Gracefully handle server startup with port conflict resolution
   * @param {Object} server - Express or HTTP server instance
   * @param {number} preferredPort - Preferred port number
   * @param {Object} options - Configuration options
   * @returns {Promise<{server: Object, port: number, conflicts: Array}>}
   */
  async startServerWithFallback(server, preferredPort, options = {}) {
    const {
      maxRetries = 10,
      serverName = 'Server',
      onPortConflict = null,
      enableConflictResolution = true
    } = options;

    // First, check for existing conflicts
    const existingConflicts = await this.getPortConflicts(preferredPort);
    
    if (existingConflicts.length > 0 && enableConflictResolution) {
      console.warn(`⚠️ Port ${preferredPort} is already in use by:`);
      existingConflicts.forEach(conflict => {
        console.warn(`   PID ${conflict.pid}: ${conflict.name} (${conflict.commandLine})`);
      });
      
      if (onPortConflict) {
        const shouldContinue = await onPortConflict(preferredPort, existingConflicts);
        if (!shouldContinue) {
          throw new Error(`Server startup cancelled due to port ${preferredPort} conflict`);
        }
      }
    }

    // Try to find an available port
    const availablePort = await this.findAvailablePort(preferredPort, maxRetries);
    
    if (!availablePort) {
      throw new Error(`No available ports found starting from ${preferredPort} (checked ${maxRetries} ports)`);
    }

    // Start the server with error handling
    return new Promise((resolve, reject) => {
      const startServer = (port) => {
        const serverInstance = server.listen(port, () => {
          this.reservePort(port);
          console.log(`✅ ${serverName} successfully started on port ${port}`);
          
          if (port !== preferredPort) {
            console.log(`ℹ️ Note: Started on port ${port} instead of preferred port ${preferredPort}`);
          }

          resolve({
            server: serverInstance,
            port,
            conflicts: existingConflicts,
            fallbackUsed: port !== preferredPort
          });
        });

        serverInstance.on('error', async (error) => {
          if (error.code === 'EADDRINUSE') {
            console.warn(`⚠️ Port ${port} became unavailable, trying next available port...`);
            
            // Try to find the next available port
            const nextPort = await this.findAvailablePort(port + 1, maxRetries - 1);
            if (nextPort) {
              startServer(nextPort);
            } else {
              reject(new Error(`Failed to start ${serverName}: No available ports found after ${port}`));
            }
          } else {
            reject(error);
          }
        });
      };

      startServer(availablePort);
    });
  }

  /**
   * Create a middleware to handle server shutdown gracefully
   * @param {number} port - Port to release on shutdown
   * @returns {Function} - Cleanup function
   */
  createShutdownHandler(port) {
    const cleanup = () => {
      console.log(`🔄 Releasing port ${port}...`);
      this.releasePort(port);
    };

    process.on('SIGTERM', cleanup);
    process.on('SIGINT', cleanup);
    process.on('exit', cleanup);

    return cleanup;
  }

  /**
   * Generate a comprehensive port status report
   * @returns {Promise<Object>} - Port status report
   */
  async generatePortReport() {
    const report = {
      timestamp: new Date().toISOString(),
      usedPorts: this.getUsedPorts(),
      reservedPorts: Array.from(this.reservedPorts),
      conflicts: {}
    };

    // Check for conflicts on commonly used ports
    const commonPorts = [3000, 3001, 4000, 4001, 4002, 5000, 8000, 8080, 9000];
    
    for (const port of commonPorts) {
      const conflicts = await this.getPortConflicts(port);
      if (conflicts.length > 0) {
        report.conflicts[port] = conflicts;
      }
    }

    return report;
  }
}

// Export singleton instance
export const portManager = new PortManager();

// Export utility functions for backward compatibility
export const isPortAvailable = (port) => portManager.isPortAvailable(port);
export const findAvailablePort = (preferredPort, maxAttempts) => portManager.findAvailablePort(preferredPort, maxAttempts);
export const getPortConflicts = (port) => portManager.getPortConflicts(port);