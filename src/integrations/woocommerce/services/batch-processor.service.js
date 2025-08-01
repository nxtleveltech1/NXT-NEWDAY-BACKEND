/**
 * WooCommerce Batch Processing Service
 * Handles large-scale sync operations with queuing and background processing
 */

const db = require('../../../config/database');
const EventEmitter = require('events');

class WooCommerceBatchProcessor extends EventEmitter {
  constructor() {
    super();
    this.isReady = false;
    this.config = {};
    this.processing = false;
    this.processingInterval = null;
    
    // Job queues for different operations
    this.queues = {
      sync: [],
      webhook: [],
      cleanup: [],
      retry: []
    };

    // Processing statistics
    this.stats = {
      totalJobs: 0,
      completedJobs: 0,
      failedJobs: 0,
      retryJobs: 0,
      avgProcessingTime: 0
    };

    // Queue limits
    this.queueLimits = {
      sync: 10,
      webhook: 100,
      cleanup: 5,
      retry: 50
    };
  }

  /**
   * Initialize batch processor
   */
  async initialize(config = {}) {
    try {
      this.config = {
        batchSize: config.batchSize || 50,
        processingInterval: config.processingInterval || 5000, // 5 seconds
        maxRetries: config.maxRetries || 3,
        retryDelay: config.retryDelay || 30000, // 30 seconds
        enableBackgroundProcessing: config.enableBackgroundProcessing !== false,
        ...config
      };

      // Initialize batch processing tables
      await this.initializeBatchTables();
      
      this.isReady = true;
      console.log('✅ WooCommerce Batch Processor initialized');
      
      return { success: true };
    } catch (error) {
      console.error('❌ Batch processor initialization failed:', error);
      throw error;
    }
  }

  /**
   * Initialize batch processing tables
   */
  async initializeBatchTables() {
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS wc_batch_jobs (
          id SERIAL PRIMARY KEY,
          job_type VARCHAR(50) NOT NULL,
          job_name VARCHAR(100) NOT NULL,
          status VARCHAR(20) DEFAULT 'pending',
          priority INTEGER DEFAULT 100,
          job_data JSONB NOT NULL,
          batch_size INTEGER DEFAULT 50,
          total_items INTEGER DEFAULT 0,
          processed_items INTEGER DEFAULT 0,
          failed_items INTEGER DEFAULT 0,
          retry_count INTEGER DEFAULT 0,
          max_retries INTEGER DEFAULT 3,
          error_details TEXT,
          started_at TIMESTAMP WITH TIME ZONE,
          completed_at TIMESTAMP WITH TIME ZONE,
          next_retry TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          INDEX(job_type),
          INDEX(status),
          INDEX(priority),
          INDEX(next_retry),
          INDEX(created_at)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS wc_batch_items (
          id SERIAL PRIMARY KEY,
          job_id INTEGER REFERENCES wc_batch_jobs(id) ON DELETE CASCADE,
          item_type VARCHAR(50) NOT NULL,
          item_id VARCHAR(100) NOT NULL,
          item_data JSONB NOT NULL,
          status VARCHAR(20) DEFAULT 'pending',
          processing_order INTEGER DEFAULT 0,
          error_details TEXT,
          processed_at TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          INDEX(job_id),
          INDEX(item_type),
          INDEX(status),
          INDEX(processing_order)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS wc_batch_progress (
          id SERIAL PRIMARY KEY,
          job_id INTEGER REFERENCES wc_batch_jobs(id) ON DELETE CASCADE,
          stage VARCHAR(50) NOT NULL,
          progress_percent DECIMAL(5,2) DEFAULT 0,
          current_item VARCHAR(100),
          message TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          INDEX(job_id),
          INDEX(created_at)
        )
      `);

      console.log('✅ Batch processing tables initialized');
    } catch (error) {
      console.error('❌ Failed to initialize batch tables:', error);
      throw error;
    }
  }

  /**
   * Start background processing
   */
  async startBackgroundProcessing() {
    if (this.processing) return;
    
    this.processing = true;
    
    this.processingInterval = setInterval(async () => {
      try {
        await this.processQueues();
        await this.processScheduledJobs();
        await this.processRetryJobs();
        await this.cleanupOldJobs();
      } catch (error) {
        console.error('❌ Background processing error:', error);
      }
    }, this.config.processingInterval);

    console.log('🚀 Background batch processing started');
  }

  /**
   * Stop background processing
   */
  async stopBackgroundProcessing() {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    
    this.processing = false;
    console.log('⏹️ Background batch processing stopped');
  }

  /**
   * Queue a batch sync job
   */
  async queueBatchSync(syncType, options = {}) {
    try {
      const jobData = {
        syncType,
        direction: options.direction || 'both',
        entityTypes: options.entityTypes || ['customers', 'products', 'orders'],
        batchSize: options.batchSize || this.config.batchSize,
        force: options.force || false,
        filters: options.filters || {}
      };

      const jobId = await this.createBatchJob('sync', `batch_${syncType}`, jobData, {
        priority: options.priority || 100,
        batchSize: jobData.batchSize
      });

      // Estimate total items
      const totalItems = await this.estimateSyncItems(jobData);
      await this.updateJobTotalItems(jobId, totalItems);

      // Create individual sync items
      await this.createSyncItems(jobId, jobData);

      console.log(`📋 Batch sync job queued: ${jobId} (${totalItems} items)`);
      this.emit('jobQueued', { jobId, type: 'sync', totalItems });

      return { jobId, totalItems };
    } catch (error) {
      console.error('❌ Failed to queue batch sync:', error);
      throw error;
    }
  }

  /**
   * Queue a batch webhook processing job
   */
  async queueBatchWebhookProcessing(webhookEvents) {
    try {
      const jobData = {
        events: webhookEvents,
        batchSize: Math.min(webhookEvents.length, this.config.batchSize)
      };

      const jobId = await this.createBatchJob('webhook', 'batch_webhook_processing', jobData, {
        priority: 200, // Higher priority for webhooks
        batchSize: jobData.batchSize
      });

      await this.updateJobTotalItems(jobId, webhookEvents.length);

      // Create webhook processing items
      for (let i = 0; i < webhookEvents.length; i++) {
        await this.createBatchItem(jobId, 'webhook_event', webhookEvents[i].id.toString(), {
          eventType: webhookEvents[i].event_type,
          payload: webhookEvents[i].payload,
          signature: webhookEvents[i].signature
        }, i);
      }

      console.log(`📋 Batch webhook processing job queued: ${jobId} (${webhookEvents.length} events)`);
      this.emit('jobQueued', { jobId, type: 'webhook', totalItems: webhookEvents.length });

      return { jobId, totalItems: webhookEvents.length };
    } catch (error) {
      console.error('❌ Failed to queue batch webhook processing:', error);
      throw error;
    }
  }

  /**
   * Process all queues
   */
  async processQueues() {
    try {
      // Get pending jobs ordered by priority
      const jobs = await this.getPendingJobs();
      
      for (const job of jobs) {
        try {
          await this.processJob(job);
        } catch (error) {
          console.error(`❌ Job processing failed: ${job.id}`, error);
          await this.failJob(job.id, error.message);
        }
      }
    } catch (error) {
      console.error('❌ Queue processing failed:', error);
    }
  }

  /**
   * Process scheduled jobs
   */
  async processScheduledJobs() {
    try {
      const scheduledJobs = await db.query(`
        SELECT * FROM wc_batch_jobs
        WHERE status = 'scheduled' AND next_retry <= NOW()
        ORDER BY priority ASC, created_at ASC
        LIMIT 5
      `);

      for (const job of scheduledJobs.rows) {
        await this.startJob(job.id);
      }
    } catch (error) {
      console.error('❌ Scheduled job processing failed:', error);
    }
  }

  /**
   * Process retry jobs
   */
  async processRetryJobs() {
    try {
      const retryJobs = await db.query(`
        SELECT * FROM wc_batch_jobs
        WHERE status = 'failed' 
          AND retry_count < max_retries 
          AND (next_retry IS NULL OR next_retry <= NOW())
        ORDER BY priority ASC, created_at ASC
        LIMIT 10
      `);

      for (const job of retryJobs.rows) {
        try {
          console.log(`🔄 Retrying job: ${job.id} (attempt ${job.retry_count + 1})`);
          await this.retryJob(job.id);
        } catch (error) {
          console.error(`❌ Job retry failed: ${job.id}`, error);
        }
      }
    } catch (error) {
      console.error('❌ Retry job processing failed:', error);
    }
  }

  /**
   * Process individual job
   */
  async processJob(job) {
    try {
      console.log(`🔄 Processing job: ${job.id} (${job.job_name})`);
      
      // Start the job
      await this.startJob(job.id);
      
      // Process based on job type
      switch (job.job_type) {
        case 'sync':
          await this.processSyncJob(job);
          break;
        case 'webhook':
          await this.processWebhookJob(job);
          break;
        case 'cleanup':
          await this.processCleanupJob(job);
          break;
        default:
          throw new Error(`Unknown job type: ${job.job_type}`);
      }

      // Complete the job
      await this.completeJob(job.id);
      
    } catch (error) {
      console.error(`❌ Job ${job.id} processing failed:`, error);
      await this.failJob(job.id, error.message);
      throw error;
    }
  }

  /**
   * Process sync job
   */
  async processSyncJob(job) {
    try {
      const jobData = JSON.parse(job.job_data);
      const SyncService = require('./sync.service');
      
      // Get items to process
      const items = await this.getJobItems(job.id, 'pending');
      let processed = 0;
      let failed = 0;

      await this.updateJobProgress(job.id, 'processing', 0, 'Starting batch sync...');

      for (let i = 0; i < items.length; i += jobData.batchSize) {
        const batch = items.slice(i, i + jobData.batchSize);
        
        try {
          // Process batch
          const results = await this.processSyncBatch(batch, jobData, SyncService);
          
          // Update item statuses
          for (const result of results) {
            if (result.success) {
              await this.completeItem(result.itemId);
              processed++;
            } else {
              await this.failItem(result.itemId, result.error);
              failed++;
            }
          }

          // Update progress
          const progressPercent = Math.round(((i + batch.length) / items.length) * 100);
          await this.updateJobProgress(job.id, 'processing', progressPercent, 
            `Processed ${processed + failed}/${items.length} items`);

          this.emit('jobProgress', { 
            jobId: job.id, 
            progress: progressPercent, 
            processed, 
            failed 
          });

        } catch (error) {
          console.error(`❌ Batch processing failed:`, error);
          // Mark batch items as failed
          for (const item of batch) {
            await this.failItem(item.id, error.message);
            failed++;
          }
        }
      }

      // Update job statistics
      await this.updateJobStats(job.id, processed, failed);
      
    } catch (error) {
      console.error(`❌ Sync job processing failed:`, error);
      throw error;
    }
  }

  /**
   * Process sync batch
   */
  async processSyncBatch(items, jobData, SyncService) {
    const results = [];
    
    for (const item of items) {
      try {
        const itemData = JSON.parse(item.item_data);
        let result;

        switch (item.item_type) {
          case 'customer_sync':
            result = await SyncService.syncCustomerFromWC(itemData.customer, `batch_${item.job_id}`, jobData.force);
            break;
          case 'product_sync':
            result = await SyncService.syncProductFromWC(itemData.product, `batch_${item.job_id}`, jobData.force);
            break;
          case 'order_sync':
            result = await SyncService.syncOrderFromWC(itemData.order, `batch_${item.job_id}`, jobData.force);
            break;
          case 'inventory_push':
            result = await SyncService.pushInventory(`batch_${item.job_id}`, { productIds: [itemData.productId] });
            break;
          default:
            throw new Error(`Unknown item type: ${item.item_type}`);
        }

        results.push({
          itemId: item.id,
          success: true,
          result
        });

      } catch (error) {
        results.push({
          itemId: item.id,
          success: false,
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Process webhook job
   */
  async processWebhookJob(job) {
    try {
      const WebhookService = require('./webhook.service');
      const items = await this.getJobItems(job.id, 'pending');
      let processed = 0;
      let failed = 0;

      await this.updateJobProgress(job.id, 'processing', 0, 'Processing webhook events...');

      for (const item of items) {
        try {
          const itemData = JSON.parse(item.item_data);
          
          await WebhookService.processEvent(
            itemData.eventType, 
            JSON.parse(itemData.payload), 
            itemData.signature
          );

          await this.completeItem(item.id);
          processed++;

        } catch (error) {
          await this.failItem(item.id, error.message);
          failed++;
        }

        // Update progress
        const progressPercent = Math.round(((processed + failed) / items.length) * 100);
        await this.updateJobProgress(job.id, 'processing', progressPercent,
          `Processed ${processed + failed}/${items.length} events`);
      }

      await this.updateJobStats(job.id, processed, failed);
      
    } catch (error) {
      console.error(`❌ Webhook job processing failed:`, error);
      throw error;
    }
  }

  /**
   * Process cleanup job
   */
  async processCleanupJob(job) {
    try {
      const jobData = JSON.parse(job.job_data);
      let cleaned = 0;

      await this.updateJobProgress(job.id, 'processing', 0, 'Starting cleanup...');

      // Clean old sync sessions
      if (jobData.cleanupSyncSessions) {
        const result = await db.query(`
          DELETE FROM wc_sync_sessions 
          WHERE created_at < NOW() - INTERVAL '${jobData.retentionDays || 30} days'
        `);
        cleaned += result.rowCount || 0;
      }

      // Clean old webhook events
      if (jobData.cleanupWebhookEvents) {
        const result = await db.query(`
          DELETE FROM wc_webhook_events 
          WHERE created_at < NOW() - INTERVAL '${jobData.retentionDays || 30} days'
            AND processing_status = 'processed'
        `);
        cleaned += result.rowCount || 0;
      }

      // Clean old performance logs
      if (jobData.cleanupPerformanceLogs) {
        const result = await db.query(`
          DELETE FROM wc_performance_log 
          WHERE started_at < NOW() - INTERVAL '${jobData.retentionDays || 30} days'
        `);
        cleaned += result.rowCount || 0;
      }

      await this.updateJobProgress(job.id, 'completed', 100, `Cleaned ${cleaned} records`);
      await this.updateJobStats(job.id, cleaned, 0);
      
    } catch (error) {
      console.error(`❌ Cleanup job processing failed:`, error);
      throw error;
    }
  }

  /**
   * Clean up old jobs
   */
  async cleanupOldJobs() {
    try {
      // Clean up completed jobs older than 7 days
      await db.query(`
        DELETE FROM wc_batch_jobs 
        WHERE status IN ('completed', 'failed') 
          AND completed_at < NOW() - INTERVAL '7 days'
      `);

      // Clean up old progress records
      await db.query(`
        DELETE FROM wc_batch_progress 
        WHERE created_at < NOW() - INTERVAL '7 days'
      `);

    } catch (error) {
      console.error('❌ Job cleanup failed:', error);
    }
  }

  // ==================== JOB MANAGEMENT ====================

  /**
   * Create batch job
   */
  async createBatchJob(jobType, jobName, jobData, options = {}) {
    try {
      const result = await db.query(`
        INSERT INTO wc_batch_jobs (
          job_type, job_name, job_data, priority, batch_size, max_retries
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `, [
        jobType,
        jobName,
        JSON.stringify(jobData),
        options.priority || 100,
        options.batchSize || this.config.batchSize,
        options.maxRetries || this.config.maxRetries
      ]);

      return result.rows[0].id;
    } catch (error) {
      console.error('❌ Failed to create batch job:', error);
      throw error;
    }
  }

  /**
   * Create batch item
   */
  async createBatchItem(jobId, itemType, itemId, itemData, processingOrder = 0) {
    try {
      await db.query(`
        INSERT INTO wc_batch_items (
          job_id, item_type, item_id, item_data, processing_order
        ) VALUES ($1, $2, $3, $4, $5)
      `, [jobId, itemType, itemId, JSON.stringify(itemData), processingOrder]);
    } catch (error) {
      console.error('❌ Failed to create batch item:', error);
      throw error;
    }
  }

  /**
   * Get pending jobs
   */
  async getPendingJobs(limit = 5) {
    try {
      const result = await db.query(`
        SELECT * FROM wc_batch_jobs
        WHERE status = 'pending'
        ORDER BY priority ASC, created_at ASC
        LIMIT $1
      `, [limit]);

      return result.rows;
    } catch (error) {
      console.error('❌ Failed to get pending jobs:', error);
      return [];
    }
  }

  /**
   * Get job items
   */
  async getJobItems(jobId, status = null) {
    try {
      let query = 'SELECT * FROM wc_batch_items WHERE job_id = $1';
      let params = [jobId];

      if (status) {
        query += ' AND status = $2';
        params.push(status);
      }

      query += ' ORDER BY processing_order ASC';

      const result = await db.query(query, params);
      return result.rows;
    } catch (error) {
      console.error('❌ Failed to get job items:', error);
      return [];
    }
  }

  /**
   * Start job
   */
  async startJob(jobId) {
    try {
      await db.query(`
        UPDATE wc_batch_jobs SET 
          status = 'running', 
          started_at = NOW(), 
          updated_at = NOW()
        WHERE id = $1
      `, [jobId]);

      this.emit('jobStarted', { jobId });
    } catch (error) {
      console.error('❌ Failed to start job:', error);
      throw error;
    }
  }

  /**
   * Complete job
   */
  async completeJob(jobId) {
    try {
      await db.query(`
        UPDATE wc_batch_jobs SET 
          status = 'completed', 
          completed_at = NOW(), 
          updated_at = NOW()
        WHERE id = $1
      `, [jobId]);

      this.stats.completedJobs++;
      this.emit('jobCompleted', { jobId });
    } catch (error) {
      console.error('❌ Failed to complete job:', error);
      throw error;
    }
  }

  /**
   * Fail job
   */
  async failJob(jobId, errorDetails) {
    try {
      await db.query(`
        UPDATE wc_batch_jobs SET 
          status = 'failed', 
          error_details = $2,
          completed_at = NOW(), 
          updated_at = NOW(),
          next_retry = NOW() + INTERVAL '${this.config.retryDelay / 1000} seconds'
        WHERE id = $1
      `, [jobId, errorDetails]);

      this.stats.failedJobs++;
      this.emit('jobFailed', { jobId, error: errorDetails });
    } catch (error) {
      console.error('❌ Failed to fail job:', error);
      throw error;
    }
  }

  /**
   * Retry job
   */
  async retryJob(jobId) {
    try {
      await db.query(`
        UPDATE wc_batch_jobs SET 
          status = 'pending',
          retry_count = retry_count + 1,
          error_details = NULL,
          updated_at = NOW()
        WHERE id = $1
      `, [jobId]);

      // Reset failed items to pending
      await db.query(`
        UPDATE wc_batch_items SET 
          status = 'pending',
          error_details = NULL
        WHERE job_id = $1 AND status = 'failed'
      `, [jobId]);

      this.stats.retryJobs++;
      this.emit('jobRetried', { jobId });
    } catch (error) {
      console.error('❌ Failed to retry job:', error);
      throw error;
    }
  }

  /**
   * Complete item
   */
  async completeItem(itemId) {
    try {
      await db.query(`
        UPDATE wc_batch_items SET 
          status = 'completed', 
          processed_at = NOW()
        WHERE id = $1
      `, [itemId]);
    } catch (error) {
      console.error('❌ Failed to complete item:', error);
    }
  }

  /**
   * Fail item
   */
  async failItem(itemId, errorDetails) {
    try {
      await db.query(`
        UPDATE wc_batch_items SET 
          status = 'failed', 
          error_details = $2,
          processed_at = NOW()
        WHERE id = $1
      `, [itemId, errorDetails]);
    } catch (error) {
      console.error('❌ Failed to fail item:', error);
    }
  }

  /**
   * Update job progress
   */
  async updateJobProgress(jobId, stage, progressPercent, message) {
    try {
      await db.query(`
        INSERT INTO wc_batch_progress (job_id, stage, progress_percent, message)
        VALUES ($1, $2, $3, $4)
      `, [jobId, stage, progressPercent, message]);
    } catch (error) {
      console.error('❌ Failed to update job progress:', error);
    }
  }

  /**
   * Update job statistics
   */
  async updateJobStats(jobId, processedItems, failedItems) {
    try {
      await db.query(`
        UPDATE wc_batch_jobs SET 
          processed_items = $2,
          failed_items = $3,
          updated_at = NOW()
        WHERE id = $1
      `, [jobId, processedItems, failedItems]);
    } catch (error) {
      console.error('❌ Failed to update job stats:', error);
    }
  }

  /**
   * Update job total items
   */
  async updateJobTotalItems(jobId, totalItems) {
    try {
      await db.query(`
        UPDATE wc_batch_jobs SET 
          total_items = $2,
          updated_at = NOW()
        WHERE id = $1
      `, [jobId, totalItems]);
    } catch (error) {
      console.error('❌ Failed to update job total items:', error);
    }
  }

  // ==================== UTILITY METHODS ====================

  /**
   * Estimate sync items
   */
  async estimateSyncItems(jobData) {
    try {
      let totalItems = 0;

      if (jobData.entityTypes.includes('customers')) {
        const result = await db.query('SELECT COUNT(*) FROM customers');
        totalItems += parseInt(result.rows[0].count);
      }

      if (jobData.entityTypes.includes('products')) {
        const result = await db.query('SELECT COUNT(*) FROM products');
        totalItems += parseInt(result.rows[0].count);
      }

      if (jobData.entityTypes.includes('orders')) {
        const result = await db.query('SELECT COUNT(*) FROM purchase_orders');
        totalItems += parseInt(result.rows[0].count);
      }

      return totalItems;
    } catch (error) {
      console.error('❌ Failed to estimate sync items:', error);
      return 0;
    }
  }

  /**
   * Create sync items
   */
  async createSyncItems(jobId, jobData) {
    try {
      let processingOrder = 0;

      // Create customer sync items
      if (jobData.entityTypes.includes('customers')) {
        const customers = await db.query('SELECT id, email FROM customers LIMIT 1000');
        for (const customer of customers.rows) {
          await this.createBatchItem(jobId, 'customer_sync', customer.id.toString(), {
            customerId: customer.id,
            email: customer.email
          }, processingOrder++);
        }
      }

      // Create product sync items
      if (jobData.entityTypes.includes('products')) {
        const products = await db.query('SELECT id, sku FROM products LIMIT 1000');
        for (const product of products.rows) {
          await this.createBatchItem(jobId, 'product_sync', product.id.toString(), {
            productId: product.id,
            sku: product.sku
          }, processingOrder++);
        }
      }

      // Create order sync items
      if (jobData.entityTypes.includes('orders')) {
        const orders = await db.query('SELECT id, order_number FROM purchase_orders LIMIT 1000');
        for (const order of orders.rows) {
          await this.createBatchItem(jobId, 'order_sync', order.id.toString(), {
            orderId: order.id,
            orderNumber: order.order_number
          }, processingOrder++);
        }
      }

    } catch (error) {
      console.error('❌ Failed to create sync items:', error);
      throw error;
    }
  }

  /**
   * Get job status
   */
  async getJobStatus(jobId) {
    try {
      const jobResult = await db.query('SELECT * FROM wc_batch_jobs WHERE id = $1', [jobId]);
      const job = jobResult.rows[0];
      
      if (!job) {
        throw new Error('Job not found');
      }

      const progressResult = await db.query(`
        SELECT * FROM wc_batch_progress 
        WHERE job_id = $1 
        ORDER BY created_at DESC 
        LIMIT 1
      `, [jobId]);

      const progress = progressResult.rows[0] || null;

      return {
        ...job,
        job_data: JSON.parse(job.job_data),
        currentProgress: progress
      };
    } catch (error) {
      console.error('❌ Failed to get job status:', error);
      throw error;
    }
  }

  /**
   * Get service readiness status
   */
  isReady() {
    return this.isReady;
  }

  /**
   * Get processing statistics
   */
  getStats() {
    return { ...this.stats };
  }
}

module.exports = new WooCommerceBatchProcessor();