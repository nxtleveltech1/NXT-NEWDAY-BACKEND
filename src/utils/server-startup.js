/**
 * Server Startup Utility
 * Provides enhanced server startup with conflict detection and resolution
 */

import { portManager } from './port-manager.js';

/**
 * Enhanced server startup configuration
 */
export class ServerStartup {
  constructor(options = {}) {
    this.options = {
      enablePortFallback: true,
      enableConflictDetection: true,
      enableGracefulShutdown: true,
      maxPortRetries: 10,
      startupTimeout: 30000, // 30 seconds
      ...options
    };
    
    this.activeServers = new Map();
    this.shutdownHandlers = [];
  }

  /**
   * Start a server with enhanced error handling and port management
   * @param {Object} config - Server configuration
   * @returns {Promise<Object>} - Server startup result
   */
  async startServer(config) {
    const {
      server,
      port: preferredPort,
      name = 'Server',
      onReady = null,
      onError = null,
      enableHealthCheck = true
    } = config;

    console.log(`🚀 Starting ${name}...`);
    
    try {
      // Pre-startup validations
      await this.validateStartupConditions(name, preferredPort);
      
      // Start server with port fallback
      const result = await portManager.startServerWithFallback(server, preferredPort, {
        serverName: name,
        maxRetries: this.options.maxPortRetries,
        enableConflictResolution: this.options.enableConflictDetection,
        onPortConflict: this.handlePortConflict.bind(this)
      });

      // Store server reference
      this.activeServers.set(name, {
        server: result.server,
        port: result.port,
        startTime: Date.now()
      });

      // Set up graceful shutdown
      if (this.options.enableGracefulShutdown) {
        this.setupGracefulShutdown(name, result.server, result.port);
      }

      // Run health check
      if (enableHealthCheck) {
        await this.performHealthCheck(result.server, result.port, name);
      }

      // Call ready callback
      if (onReady) {
        await onReady(result);
      }

      console.log(`✅ ${name} startup completed successfully on port ${result.port}`);
      
      return {
        success: true,
        server: result.server,
        port: result.port,
        fallbackUsed: result.fallbackUsed,
        conflicts: result.conflicts,
        serverName: name
      };

    } catch (error) {
      console.error(`❌ Failed to start ${name}:`, error.message);
      
      if (onError) {
        await onError(error);
      }
      
      return {
        success: false,
        error: error.message,
        serverName: name
      };
    }
  }

  /**
   * Validate startup conditions before attempting to start server
   * @param {string} name - Server name
   * @param {number} port - Preferred port
   */
  async validateStartupConditions(name, port) {
    // Check if server with same name is already running
    if (this.activeServers.has(name)) {
      throw new Error(`Server '${name}' is already running`);
    }

    // Validate port number
    if (!port || port < 1 || port > 65535) {
      throw new Error(`Invalid port number: ${port}`);
    }

    // Check for critical system resource availability
    if (this.options.enableConflictDetection) {
      const conflicts = await portManager.getPortConflicts(port);
      console.log(`ℹ️ Port ${port} conflict check: ${conflicts.length} existing processes found`);
    }
  }

  /**
   * Handle port conflict detection
   * @param {number} port - Conflicted port
   * @param {Array} conflicts - Array of conflicting processes
   * @returns {boolean} - Whether to continue with startup
   */
  async handlePortConflict(port, conflicts) {
    console.log(`🔍 Detected ${conflicts.length} process(es) using port ${port}:`);
    
    conflicts.forEach((conflict, index) => {
      console.log(`   ${index + 1}. PID ${conflict.pid}: ${conflict.name}`);
      if (conflict.commandLine && conflict.commandLine !== 'Unknown') {
        console.log(`      Command: ${conflict.commandLine}`);
      }
    });

    // Check if any conflicts are our own processes
    const ownProcesses = conflicts.filter(c => 
      c.name === 'node.exe' && 
      (c.commandLine.includes('index.js') || c.commandLine.includes('test-server.js'))
    );

    if (ownProcesses.length > 0) {
      console.log(`⚠️ Found ${ownProcesses.length} existing Node.js server(s). Using fallback port.`);
      return true; // Continue with fallback
    }

    // For other processes, log and continue with fallback
    console.log(`ℹ️ Port ${port} is busy. Will try alternative ports.`);
    return true;
  }

  /**
   * Set up graceful shutdown handling for a server
   * @param {string} name - Server name
   * @param {Object} server - Server instance
   * @param {number} port - Server port
   */
  setupGracefulShutdown(name, server, port) {
    const shutdownHandler = async () => {
      console.log(`🔄 Gracefully shutting down ${name}...`);
      
      try {
        // Close server
        await new Promise((resolve) => {
          server.close(resolve);
        });
        
        // Release port
        portManager.releasePort(port);
        
        // Remove from active servers
        this.activeServers.delete(name);
        
        console.log(`✅ ${name} shut down successfully`);
      } catch (error) {
        console.error(`❌ Error shutting down ${name}:`, error);
      }
    };

    // Store shutdown handler
    this.shutdownHandlers.push(shutdownHandler);

    // Register shutdown events (only once)
    if (this.shutdownHandlers.length === 1) {
      process.on('SIGTERM', this.shutdownAll.bind(this));
      process.on('SIGINT', this.shutdownAll.bind(this));
      process.on('exit', this.shutdownAll.bind(this));
    }
  }

  /**
   * Perform basic health check on started server
   * @param {Object} server - Server instance
   * @param {number} port - Server port
   * @param {string} name - Server name
   */
  async performHealthCheck(server, port, name) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Health check timeout for ${name}`));
      }, 5000);

      // Simple connection test
      const testConnection = () => {
        const client = new (await import('net')).Socket();
        
        client.connect(port, 'localhost', () => {
          clearTimeout(timeout);
          client.end();
          console.log(`✅ Health check passed for ${name}`);
          resolve();
        });

        client.on('error', (error) => {
          clearTimeout(timeout);
          reject(new Error(`Health check failed for ${name}: ${error.message}`));
        });
      };

      // Give server a moment to start listening
      setTimeout(testConnection, 1000);
    });
  }

  /**
   * Shutdown all active servers
   */
  async shutdownAll() {
    if (this.shutdownHandlers.length === 0) return;

    console.log('🔄 Shutting down all servers...');
    
    await Promise.all(this.shutdownHandlers.map(handler => 
      handler().catch(error => console.error('Shutdown error:', error))
    ));
    
    console.log('✅ All servers shut down');
    process.exit(0);
  }

  /**
   * Get status of all active servers
   * @returns {Object} - Server status report
   */
  getServerStatus() {
    const status = {
      activeServers: this.activeServers.size,
      servers: {},
      uptime: {}
    };

    this.activeServers.forEach((info, name) => {
      status.servers[name] = {
        port: info.port,
        running: true
      };
      status.uptime[name] = Date.now() - info.startTime;
    });

    return status;
  }

  /**
   * Start multiple servers with dependency management
   * @param {Array} serverConfigs - Array of server configurations
   * @param {Object} options - Startup options
   * @returns {Promise<Array>} - Array of startup results
   */
  async startMultipleServers(serverConfigs, options = {}) {
    const { sequential = false, failFast = true } = options;
    const results = [];

    if (sequential) {
      // Start servers one by one
      for (const config of serverConfigs) {
        const result = await this.startServer(config);
        results.push(result);
        
        if (!result.success && failFast) {
          throw new Error(`Failed to start ${config.name}, aborting remaining servers`);
        }
      }
    } else {
      // Start servers in parallel
      const promises = serverConfigs.map(config => this.startServer(config));
      const allResults = await Promise.allSettled(promises);
      
      allResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          results.push({
            success: false,
            error: result.reason.message,
            serverName: serverConfigs[index].name
          });
        }
      });
    }

    // Summary
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    console.log(`📊 Server startup summary: ${successful} successful, ${failed} failed`);
    
    if (failed > 0 && failFast) {
      console.error('❌ Some servers failed to start:');
      results.filter(r => !r.success).forEach(r => {
        console.error(`   - ${r.serverName}: ${r.error}`);
      });
    }

    return results;
  }
}

// Export singleton instance
export const serverStartup = new ServerStartup();

// Utility function for simple server startup
export async function startServerSafely(server, port, name = 'Server') {
  return serverStartup.startServer({ server, port, name });
}