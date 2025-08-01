/**
 * WooCommerce Integration Hub
 * Complete bi-directional sync system with real-time updates
 */

const WooCommerceSync = require('./services/sync.service');
const WebhookManager = require('./services/webhook.service');
const ConflictResolver = require('./services/conflict-resolver.service'); 
const MonitoringService = require('./services/monitoring.service');
const BatchProcessor = require('./services/batch-processor.service');
const ErrorRecovery = require('./services/error-recovery.service');

class WooCommerceIntegration {
  constructor() {
    this.sync = WooCommerceSync;
    this.webhooks = WebhookManager;
    this.conflicts = ConflictResolver;
    this.monitoring = MonitoringService;
    this.batch = BatchProcessor;
    this.recovery = ErrorRecovery;
    
    this.isInitialized = false;
    this.realTimeEnabled = false;
  }

  /**
   * Initialize the complete WooCommerce integration
   */
  async initialize(config = {}) {
    try {
      console.log('🚀 Initializing WooCommerce Integration Hub...');
      
      // Initialize core services
      await this.sync.initialize(config);
      await this.webhooks.initialize(config);
      await this.conflicts.initialize(config);
      await this.monitoring.initialize(config);
      await this.batch.initialize(config);
      await this.recovery.initialize(config);
      
      // Setup real-time monitoring
      if (config.enableRealTime !== false) {
        await this.enableRealTimeSync();
      }
      
      this.isInitialized = true;
      console.log('✅ WooCommerce Integration Hub initialized successfully');
      
      return { success: true, services: this.getServiceStatus() };
    } catch (error) {
      console.error('❌ WooCommerce Integration initialization failed:', error);
      throw error;
    }
  }

  /**
   * Enable real-time synchronization
   */
  async enableRealTimeSync() {
    try {
      // Setup webhook endpoints
      await this.webhooks.setupEndpoints();
      
      // Configure real-time monitoring
      await this.monitoring.enableRealTime();
      
      // Start background processors
      await this.batch.startBackgroundProcessing();
      
      this.realTimeEnabled = true;
      console.log('✅ Real-time sync enabled');
    } catch (error) {
      console.error('❌ Real-time sync setup failed:', error);
      throw error;
    }
  }

  /**
   * Get overall service status
   */
  getServiceStatus() {
    return {
      initialized: this.isInitialized,
      realTimeEnabled: this.realTimeEnabled,
      services: {
        sync: this.sync.isReady(),
        webhooks: this.webhooks.isReady(),
        conflicts: this.conflicts.isReady(),
        monitoring: this.monitoring.isReady(),
        batch: this.batch.isReady(),
        recovery: this.recovery.isReady()
      }
    };
  }

  /**
   * Execute full bi-directional sync
   */
  async fullSync(options = {}) {
    if (!this.isInitialized) {
      throw new Error('Integration not initialized');
    }

    try {
      console.log('🔄 Starting full bi-directional sync...');
      
      // Start monitoring
      const syncId = await this.monitoring.startSync('full', options);
      
      try {
        // Execute sync with conflict resolution
        const results = await this.sync.fullBidirectionalSync({
          ...options,
          syncId,
          conflictResolver: this.conflicts,
          monitoring: this.monitoring
        });
        
        // Process any errors through recovery system
        if (results.errors?.length > 0) {
          await this.recovery.processErrors(syncId, results.errors);
        }
        
        await this.monitoring.completeSync(syncId, results);
        return results;
        
      } catch (error) {
        await this.monitoring.failSync(syncId, error);
        throw error;
      }
    } catch (error) {
      console.error('❌ Full sync failed:', error);
      throw error;
    }
  }

  /**
   * Process webhook event
   */
  async processWebhook(event, data, signature) {
    if (!this.isInitialized) {
      throw new Error('Integration not initialized');
    }

    return await this.webhooks.processEvent(event, data, signature);
  }

  /**
   * Get comprehensive analytics
   */
  async getAnalytics(timeframe = '30d') {
    if (!this.isInitialized) {
      throw new Error('Integration not initialized');
    }

    return await this.monitoring.getComprehensiveAnalytics(timeframe);
  }

  /**
   * Get real-time dashboard data
   */
  async getDashboardData() {
    if (!this.isInitialized) {
      throw new Error('Integration not initialized');
    }

    return await this.monitoring.getDashboardData();
  }

  /**
   * Shutdown gracefully
   */
  async shutdown() {
    try {
      console.log('🛑 Shutting down WooCommerce Integration...');
      
      await this.batch.stopBackgroundProcessing();
      await this.monitoring.shutdown();
      await this.webhooks.shutdown();
      
      this.isInitialized = false;
      this.realTimeEnabled = false;
      
      console.log('✅ WooCommerce Integration shutdown complete');
    } catch (error) {
      console.error('❌ Shutdown error:', error);
    }
  }
}

module.exports = new WooCommerceIntegration();