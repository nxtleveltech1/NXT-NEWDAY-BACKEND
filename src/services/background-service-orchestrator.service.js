/**
 * Background Service Orchestrator
 * Manages and coordinates all background services to prevent conflicts and resource exhaustion
 */

import queryOptimizationService from './query-optimization.service.js';
import materializedViewRefreshService from './materialized-view-refresh.service.js';
import { integrationMonitoringService } from './integration-monitoring.service.js';
import { realtimeService } from './realtime-service.js';

class BackgroundServiceOrchestrator {
  constructor() {
    this.services = new Map();
    this.isInitialized = false;
    this.healthCheckInterval = null;
  }

  /**
   * Initialize all background services in proper order
   */
  async initialize() {
    if (this.isInitialized) {
      console.log('Background service orchestrator already initialized');
      return;
    }

    try {
      console.log('Initializing background service orchestrator...');

      // Initialize query optimization first (foundation service)
      console.log('1/4 Initializing query optimization service...');
      await queryOptimizationService.initialize();
      this.services.set('queryOptimization', { service: queryOptimizationService, status: 'active' });

      // Initialize materialized view refresh service
      console.log('2/4 Initializing materialized view refresh service...');
      await materializedViewRefreshService.createMaterializedViews();
      await materializedViewRefreshService.initialize();
      this.services.set('materializedViews', { service: materializedViewRefreshService, status: 'active' });

      // Initialize realtime service
      console.log('3/4 Initializing realtime service...');
      await realtimeService.initialize();
      this.services.set('realtime', { service: realtimeService, status: 'active' });

      // Initialize integration monitoring (last, as it monitors others)
      console.log('4/4 Initializing integration monitoring service...');
      await integrationMonitoringService.startMonitoring({ 
        healthCheckInterval: 300000, // 5 minutes
        enableAutoRecovery: true 
      });
      this.services.set('monitoring', { service: integrationMonitoringService, status: 'active' });

      // Start orchestrator health monitoring
      this.startHealthMonitoring();

      this.isInitialized = true;
      console.log('Background service orchestrator initialized successfully');

    } catch (error) {
      console.error('Failed to initialize background service orchestrator:', error);
      throw error;
    }
  }

  /**
   * Start health monitoring for all services
   */
  startHealthMonitoring() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(() => {
      this.checkServicesHealth();
    }, 600000); // Check every 10 minutes

    console.log('Background service health monitoring started');
  }

  /**
   * Check health of all managed services
   */
  async checkServicesHealth() {
    try {
      console.log('Performing background services health check...');
      
      for (const [serviceName, serviceInfo] of this.services.entries()) {
        try {
          // Basic service health check
          if (serviceInfo.service && typeof serviceInfo.service.getStatus === 'function') {
            const status = await serviceInfo.service.getStatus();
            serviceInfo.status = status.healthy ? 'active' : 'error';
          }
        } catch (error) {
          console.error(`Health check failed for ${serviceName}:`, error.message);
          serviceInfo.status = 'error';
        }
      }

      const healthyServices = Array.from(this.services.values()).filter(s => s.status === 'active').length;
      const totalServices = this.services.size;
      
      console.log(`Services health check completed: ${healthyServices}/${totalServices} services healthy`);

    } catch (error) {
      console.error('Services health check error:', error);
    }
  }

  /**
   * Get status of all managed services
   */
  getServicesStatus() {
    const status = {
      orchestratorStatus: this.isInitialized ? 'active' : 'inactive',
      services: {},
      totalServices: this.services.size,
      healthyServices: 0,
      timestamp: new Date().toISOString()
    };

    for (const [serviceName, serviceInfo] of this.services.entries()) {
      status.services[serviceName] = {
        status: serviceInfo.status,
        initialized: serviceInfo.service ? true : false
      };
      
      if (serviceInfo.status === 'active') {
        status.healthyServices++;
      }
    }

    return status;
  }

  /**
   * Graceful shutdown of all services
   */
  async shutdown() {
    console.log('Shutting down background service orchestrator...');

    // Stop health monitoring
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    // Shutdown services in reverse order
    const shutdownOrder = ['monitoring', 'realtime', 'materializedViews', 'queryOptimization'];

    for (const serviceName of shutdownOrder) {
      const serviceInfo = this.services.get(serviceName);
      if (serviceInfo && serviceInfo.service) {
        try {
          if (typeof serviceInfo.service.cleanup === 'function') {
            await serviceInfo.service.cleanup();
            console.log(`Service ${serviceName} shut down successfully`);
          } else if (typeof serviceInfo.service.stopMonitoring === 'function') {
            await serviceInfo.service.stopMonitoring();
            console.log(`Service ${serviceName} stopped successfully`);
          }
          serviceInfo.status = 'inactive';
        } catch (error) {
          console.error(`Error shutting down service ${serviceName}:`, error);
        }
      }
    }

    this.services.clear();
    this.isInitialized = false;
    console.log('Background service orchestrator shut down complete');
  }

  /**
   * Restart a specific service
   */
  async restartService(serviceName) {
    const serviceInfo = this.services.get(serviceName);
    if (!serviceInfo) {
      throw new Error(`Service ${serviceName} not found`);
    }

    console.log(`Restarting service: ${serviceName}`);

    try {
      // Stop the service
      if (typeof serviceInfo.service.cleanup === 'function') {
        await serviceInfo.service.cleanup();
      }

      // Restart based on service type
      switch (serviceName) {
        case 'realtime':
          await realtimeService.initialize();
          break;
        case 'materializedViews':
          await materializedViewRefreshService.initialize();
          break;
        case 'queryOptimization':
          await queryOptimizationService.initialize();
          break;
        default:
          console.warn(`Don't know how to restart service: ${serviceName}`);
      }

      serviceInfo.status = 'active';
      console.log(`Service ${serviceName} restarted successfully`);

    } catch (error) {
      serviceInfo.status = 'error';
      console.error(`Failed to restart service ${serviceName}:`, error);
      throw error;
    }
  }
}

// Create singleton instance
const backgroundServiceOrchestrator = new BackgroundServiceOrchestrator();

export default backgroundServiceOrchestrator;