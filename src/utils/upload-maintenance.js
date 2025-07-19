import { eq, and, sql, lt, gte } from 'drizzle-orm';
import { db } from '../config/database.js';
import { uploadHistory, priceLists, priceListItems } from '../db/schema.js';
import { getUploadLogger } from './upload-logger.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * Upload maintenance and cleanup utilities
 */
export class UploadMaintenance {
  constructor(options = {}) {
    this.logger = getUploadLogger();
    this.tempDir = options.tempDir || path.join(process.cwd(), 'temp', 'uploads');
    this.retentionDays = options.retentionDays || 30;
    this.maxFileAge = options.maxFileAge || 7; // days
    this.maintenanceInterval = options.maintenanceInterval || 24 * 60 * 60 * 1000; // 24 hours
    
    this.isRunning = false;
    this.lastMaintenanceRun = null;
    
    if (options.autoStart !== false) {
      this.startMaintenanceSchedule();
    }
  }

  /**
   * Start automatic maintenance schedule
   */
  startMaintenanceSchedule() {
    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer);
    }
    
    this.maintenanceTimer = setInterval(() => {
      this.runMaintenance().catch(error => {
        this.logger.logError(null, 'maintenance_schedule', error);
      });
    }, this.maintenanceInterval);
    
    this.logger.logInfo('Upload maintenance schedule started', {
      intervalHours: this.maintenanceInterval / (60 * 60 * 1000)
    });
  }

  /**
   * Stop maintenance schedule
   */
  stopMaintenanceSchedule() {
    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer);
      this.maintenanceTimer = null;
    }
    
    this.logger.logInfo('Upload maintenance schedule stopped');
  }

  /**
   * Run comprehensive maintenance
   */
  async runMaintenance() {
    if (this.isRunning) {
      this.logger.logInfo('Maintenance already running, skipping');
      return;
    }

    this.isRunning = true;
    this.lastMaintenanceRun = new Date();
    
    try {
      this.logger.logInfo('Starting upload maintenance');
      
      const results = await Promise.all([
        this.cleanupOldUploadHistory(),
        this.cleanupOrphanedPriceListItems(),
        this.cleanupTempFiles(),
        this.cleanupLogFiles(),
        this.optimizeDatabase(),
        this.generateMaintenanceReport()
      ]);

      const [historyCleanup, orphanCleanup, tempCleanup, logCleanup, dbOptimization, report] = results;
      
      const summary = {
        uploadHistoryRecordsDeleted: historyCleanup.deleted,
        orphanedItemsDeleted: orphanCleanup.deleted,
        tempFilesDeleted: tempCleanup.deleted,
        logFilesDeleted: logCleanup.deleted,
        databaseOptimized: dbOptimization.success,
        report
      };
      
      this.logger.logInfo('Upload maintenance completed', summary);
      
      return summary;
      
    } catch (error) {
      this.logger.logError(null, 'maintenance_run', error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Clean up old upload history records
   */
  async cleanupOldUploadHistory() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);
    
    try {
      // First, get count of records to be deleted
      const countResult = await db
        .select({ count: sql`count(*)` })
        .from(uploadHistory)
        .where(
          and(
            lt(uploadHistory.uploadDate, cutoffDate),
            eq(uploadHistory.status, 'completed')
          )
        );
      
      const recordsToDelete = Number(countResult[0].count);
      
      if (recordsToDelete === 0) {
        return { deleted: 0, message: 'No old upload history to clean' };
      }
      
      // Delete old completed uploads
      const deleteResult = await db
        .delete(uploadHistory)
        .where(
          and(
            lt(uploadHistory.uploadDate, cutoffDate),
            eq(uploadHistory.status, 'completed')
          )
        );
      
      this.logger.logInfo('Old upload history cleaned', {
        recordsDeleted: recordsToDelete,
        cutoffDate: cutoffDate.toISOString()
      });
      
      return { deleted: recordsToDelete, cutoffDate };
      
    } catch (error) {
      this.logger.logError(null, 'cleanup_upload_history', error);
      return { deleted: 0, error: error.message };
    }
  }

  /**
   * Clean up orphaned price list items
   */
  async cleanupOrphanedPriceListItems() {
    try {
      // Find price list items without corresponding price lists
      const orphanedItems = await db
        .select({ 
          itemId: priceListItems.id,
          priceListId: priceListItems.priceListId 
        })
        .from(priceListItems)
        .leftJoin(priceLists, eq(priceListItems.priceListId, priceLists.id))
        .where(sql`${priceLists.id} IS NULL`)
        .limit(1000); // Process in batches
      
      if (orphanedItems.length === 0) {
        return { deleted: 0, message: 'No orphaned price list items found' };
      }
      
      const itemIds = orphanedItems.map(item => item.itemId);
      
      // Delete orphaned items
      const deleteResult = await db
        .delete(priceListItems)
        .where(sql`${priceListItems.id} = ANY(${itemIds})`);
      
      this.logger.logInfo('Orphaned price list items cleaned', {
        itemsDeleted: orphanedItems.length
      });
      
      return { deleted: orphanedItems.length };
      
    } catch (error) {
      this.logger.logError(null, 'cleanup_orphaned_items', error);
      return { deleted: 0, error: error.message };
    }
  }

  /**
   * Clean up temporary files
   */
  async cleanupTempFiles() {
    let deletedCount = 0;
    
    try {
      // Ensure temp directory exists
      await fs.mkdir(this.tempDir, { recursive: true });
      
      const files = await fs.readdir(this.tempDir);
      const cutoffTime = Date.now() - (this.maxFileAge * 24 * 60 * 60 * 1000);
      
      for (const file of files) {
        try {
          const filePath = path.join(this.tempDir, file);
          const stats = await fs.stat(filePath);
          
          if (stats.mtime.getTime() < cutoffTime) {
            await fs.unlink(filePath);
            deletedCount++;
          }
        } catch (fileError) {
          // Log but continue with other files
          this.logger.logError(null, 'cleanup_temp_file', fileError);
        }
      }
      
      this.logger.logInfo('Temporary files cleaned', {
        filesDeleted: deletedCount,
        tempDir: this.tempDir
      });
      
      return { deleted: deletedCount };
      
    } catch (error) {
      this.logger.logError(null, 'cleanup_temp_files', error);
      return { deleted: deletedCount, error: error.message };
    }
  }

  /**
   * Clean up old log files
   */
  async cleanupLogFiles() {
    let deletedCount = 0;
    
    try {
      const logDir = this.logger.logDir;
      const files = await fs.readdir(logDir);
      const cutoffTime = Date.now() - (this.retentionDays * 24 * 60 * 60 * 1000);
      
      for (const file of files) {
        try {
          if (file.startsWith('upload-') && file.endsWith('.log')) {
            const filePath = path.join(logDir, file);
            const stats = await fs.stat(filePath);
            
            if (stats.mtime.getTime() < cutoffTime) {
              await fs.unlink(filePath);
              deletedCount++;
            }
          }
        } catch (fileError) {
          // Log but continue with other files
          this.logger.logError(null, 'cleanup_log_file', fileError);
        }
      }
      
      this.logger.logInfo('Log files cleaned', {
        filesDeleted: deletedCount,
        logDir
      });
      
      return { deleted: deletedCount };
      
    } catch (error) {
      this.logger.logError(null, 'cleanup_log_files', error);
      return { deleted: deletedCount, error: error.message };
    }
  }

  /**
   * Optimize database performance
   */
  async optimizeDatabase() {
    try {
      // Analyze tables for better query planning
      const tables = ['upload_history', 'price_lists', 'price_list_items'];
      
      for (const table of tables) {
        await db.execute(sql`ANALYZE ${sql.identifier(table)}`);
      }
      
      // Vacuum to reclaim space (for PostgreSQL)
      await db.execute(sql`VACUUM (ANALYZE)`);
      
      this.logger.logInfo('Database optimization completed', {
        tablesAnalyzed: tables.length
      });
      
      return { success: true, tablesOptimized: tables };
      
    } catch (error) {
      this.logger.logError(null, 'database_optimization', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Generate maintenance report
   */
  async generateMaintenanceReport() {
    try {
      const now = new Date();
      const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      
      // Upload statistics
      const [uploadStats, recentUploads, errorStats] = await Promise.all([
        this.getUploadStatistics(last30Days),
        this.getRecentUploadTrends(last7Days),
        this.getErrorAnalysis(last7Days)
      ]);
      
      const report = {
        reportDate: now.toISOString(),
        period: '30 days',
        uploadStatistics: uploadStats,
        recentTrends: recentUploads,
        errorAnalysis: errorStats,
        systemHealth: this.getSystemHealth()
      };
      
      this.logger.logInfo('Maintenance report generated', {
        totalUploads: uploadStats.totalUploads,
        successRate: uploadStats.successRate,
        errorCount: errorStats.totalErrors
      });
      
      return report;
      
    } catch (error) {
      this.logger.logError(null, 'generate_report', error);
      return { error: error.message };
    }
  }

  /**
   * Get upload statistics for a period
   */
  async getUploadStatistics(since) {
    try {
      const stats = await db
        .select({
          totalUploads: sql`count(*)`,
          successfulUploads: sql`count(*) filter (where status = 'completed')`,
          failedUploads: sql`count(*) filter (where status = 'failed')`,
          pendingUploads: sql`count(*) filter (where status = 'processing')`,
          totalItems: sql`sum(coalesce(item_count, 0))`,
          averageFileSize: sql`avg(file_size)`,
          totalFileSize: sql`sum(file_size)`
        })
        .from(uploadHistory)
        .where(gte(uploadHistory.uploadDate, since));
      
      const result = stats[0];
      const successRate = result.totalUploads > 0 ? 
        (Number(result.successfulUploads) / Number(result.totalUploads) * 100).toFixed(2) : 0;
      
      return {
        ...result,
        successRate: parseFloat(successRate),
        period: since.toISOString()
      };
      
    } catch (error) {
      this.logger.logError(null, 'get_upload_statistics', error);
      return { error: error.message };
    }
  }

  /**
   * Get recent upload trends
   */
  async getRecentUploadTrends(since) {
    try {
      const trends = await db
        .select({
          date: sql`date_trunc('day', upload_date)`,
          uploadCount: sql`count(*)`,
          successCount: sql`count(*) filter (where status = 'completed')`,
          failureCount: sql`count(*) filter (where status = 'failed')`
        })
        .from(uploadHistory)
        .where(gte(uploadHistory.uploadDate, since))
        .groupBy(sql`date_trunc('day', upload_date)`)
        .orderBy(sql`date_trunc('day', upload_date)`);
      
      return trends.map(trend => ({
        date: trend.date,
        uploadCount: Number(trend.uploadCount),
        successCount: Number(trend.successCount),
        failureCount: Number(trend.failureCount),
        successRate: trend.uploadCount > 0 ? 
          (Number(trend.successCount) / Number(trend.uploadCount) * 100).toFixed(2) : 0
      }));
      
    } catch (error) {
      this.logger.logError(null, 'get_upload_trends', error);
      return { error: error.message };
    }
  }

  /**
   * Get error analysis
   */
  async getErrorAnalysis(since) {
    try {
      const errors = await db
        .select({
          errorType: sql`jsonb_extract_path_text(errors, '0', 'type')`,
          errorCount: sql`count(*)`
        })
        .from(uploadHistory)
        .where(
          and(
            gte(uploadHistory.uploadDate, since),
            eq(uploadHistory.status, 'failed')
          )
        )
        .groupBy(sql`jsonb_extract_path_text(errors, '0', 'type')`)
        .orderBy(sql`count(*) desc`)
        .limit(10);
      
      const totalErrors = errors.reduce((sum, error) => sum + Number(error.errorCount), 0);
      
      return {
        totalErrors,
        errorBreakdown: errors.map(error => ({
          type: error.errorType || 'unknown',
          count: Number(error.errorCount),
          percentage: totalErrors > 0 ? 
            (Number(error.errorCount) / totalErrors * 100).toFixed(2) : 0
        }))
      };
      
    } catch (error) {
      this.logger.logError(null, 'get_error_analysis', error);
      return { error: error.message };
    }
  }

  /**
   * Get system health metrics
   */
  getSystemHealth() {
    try {
      const memoryUsage = process.memoryUsage();
      const uptime = process.uptime();
      
      return {
        memory: {
          rss: Math.round(memoryUsage.rss / 1024 / 1024), // MB
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024), // MB
          heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024), // MB
          external: Math.round(memoryUsage.external / 1024 / 1024) // MB
        },
        uptime: {
          seconds: uptime,
          days: Math.floor(uptime / (24 * 60 * 60)),
          hours: Math.floor((uptime % (24 * 60 * 60)) / (60 * 60))
        },
        lastMaintenanceRun: this.lastMaintenanceRun?.toISOString(),
        maintenanceRunning: this.isRunning
      };
      
    } catch (error) {
      this.logger.logError(null, 'get_system_health', error);
      return { error: error.message };
    }
  }

  /**
   * Force cleanup of specific upload
   */
  async forceCleanupUpload(uploadId) {
    try {
      const result = await db
        .delete(uploadHistory)
        .where(eq(uploadHistory.id, uploadId))
        .returning();
      
      if (result.length > 0) {
        this.logger.logInfo('Upload forcefully cleaned', { uploadId });
        return { success: true, message: 'Upload record deleted' };
      } else {
        return { success: false, message: 'Upload not found' };
      }
      
    } catch (error) {
      this.logger.logError(uploadId, 'force_cleanup', error);
      throw error;
    }
  }

  /**
   * Emergency cleanup - removes all failed uploads older than 1 day
   */
  async emergencyCleanup() {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    try {
      const result = await db
        .delete(uploadHistory)
        .where(
          and(
            lt(uploadHistory.uploadDate, oneDayAgo),
            eq(uploadHistory.status, 'failed')
          )
        );
      
      this.logger.logInfo('Emergency cleanup completed', {
        cutoffDate: oneDayAgo.toISOString()
      });
      
      return { success: true, message: 'Emergency cleanup completed' };
      
    } catch (error) {
      this.logger.logError(null, 'emergency_cleanup', error);
      throw error;
    }
  }

  /**
   * Get maintenance status
   */
  getMaintenanceStatus() {
    return {
      isRunning: this.isRunning,
      lastRun: this.lastMaintenanceRun,
      nextRun: this.maintenanceTimer ? 
        new Date(Date.now() + this.maintenanceInterval) : null,
      intervalHours: this.maintenanceInterval / (60 * 60 * 1000),
      retentionDays: this.retentionDays,
      tempDir: this.tempDir
    };
  }

  /**
   * Shutdown maintenance
   */
  shutdown() {
    this.stopMaintenanceSchedule();
    this.logger.logInfo('Upload maintenance shutdown');
  }
}

// Default maintenance instance
let defaultMaintenance = null;

/**
 * Get or create maintenance instance
 */
export function getUploadMaintenance(options) {
  if (!defaultMaintenance) {
    defaultMaintenance = new UploadMaintenance(options);
  }
  return defaultMaintenance;
}