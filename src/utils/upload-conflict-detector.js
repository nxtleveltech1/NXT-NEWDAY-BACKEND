import { eq, and, gte, desc } from 'drizzle-orm';
import { db } from '../config/database.js';
import { priceLists, uploadHistory, suppliers } from '../db/schema.js';

/**
 * Conflict types that can occur during price list uploads
 */
export const CONFLICT_TYPES = {
  DUPLICATE_UPLOAD: 'duplicate_upload',
  ACTIVE_PRICE_LIST: 'active_price_list',
  PENDING_UPLOAD: 'pending_upload',
  CONCURRENT_UPLOAD: 'concurrent_upload',
  FILE_SIZE_LIMIT: 'file_size_limit',
  SUPPLIER_INACTIVE: 'supplier_inactive',
  RATE_LIMIT: 'rate_limit',
  MAINTENANCE_MODE: 'maintenance_mode'
};

/**
 * Resolution strategies for different conflict types
 */
export const RESOLUTION_STRATEGIES = {
  QUEUE_WITH_DELAY: 'queue_with_delay',
  REPLACE_EXISTING: 'replace_existing',
  MERGE_WITH_EXISTING: 'merge_with_existing',
  CANCEL_UPLOAD: 'cancel_upload',
  REQUEST_APPROVAL: 'request_approval',
  INCREASE_PRIORITY: 'increase_priority'
};

/**
 * Upload conflict detection and resolution system
 */
export class ConflictDetector {
  constructor(options = {}) {
    this.maxFileSize = options.maxFileSize || 50 * 1024 * 1024; // 50MB
    this.maxDailyUploads = options.maxDailyUploads || 50;
    this.maxHourlyUploads = options.maxHourlyUploads || 10;
    this.duplicateDetectionWindow = options.duplicateDetectionWindow || 24 * 60 * 60 * 1000; // 24 hours
    this.maintenanceMode = false;
  }

  /**
   * Check for all possible conflicts before queuing an upload
   */
  async checkForConflicts(upload) {
    const conflicts = [];
    
    try {
      // Check each potential conflict type
      await Promise.all([
        this.checkDuplicateUpload(upload, conflicts),
        this.checkActivePriceList(upload, conflicts),
        this.checkPendingUploads(upload, conflicts),
        this.checkConcurrentUploads(upload, conflicts),
        this.checkFileSizeLimit(upload, conflicts),
        this.checkSupplierStatus(upload, conflicts),
        this.checkRateLimit(upload, conflicts),
        this.checkMaintenanceMode(upload, conflicts)
      ]);

      // Determine if any conflicts require immediate attention
      const hasBlockingConflict = conflicts.some(conflict => 
        conflict.severity === 'critical' || conflict.blocking === true
      );

      return {
        hasConflict: conflicts.length > 0,
        hasBlockingConflict,
        conflicts: conflicts.length,
        details: conflicts,
        suggestedResolution: this.getSuggestedResolution(conflicts)
      };
      
    } catch (error) {
      // If conflict detection fails, err on the side of caution
      return {
        hasConflict: true,
        hasBlockingConflict: true,
        conflicts: 1,
        details: [{
          type: 'system_error',
          severity: 'critical',
          message: `Conflict detection failed: ${error.message}`,
          blocking: true
        }],
        suggestedResolution: {
          strategy: RESOLUTION_STRATEGIES.CANCEL_UPLOAD,
          reason: 'System error during conflict detection'
        }
      };
    }
  }

  /**
   * Check for duplicate uploads (same file, same supplier, recent timeframe)
   */
  async checkDuplicateUpload(upload, conflicts) {
    const cutoffTime = new Date(Date.now() - this.duplicateDetectionWindow);
    
    try {
      const recentUploads = await db
        .select()
        .from(uploadHistory)
        .where(
          and(
            eq(uploadHistory.supplierId, upload.supplierId),
            eq(uploadHistory.fileName, upload.file.originalname),
            eq(uploadHistory.fileSize, upload.file.size),
            gte(uploadHistory.uploadDate, cutoffTime)
          )
        )
        .orderBy(desc(uploadHistory.uploadDate))
        .limit(5);

      const exactDuplicates = recentUploads.filter(recent => 
        recent.fileName === upload.file.originalname &&
        recent.fileSize === upload.file.size &&
        (recent.status === 'completed' || recent.status === 'processing')
      );

      if (exactDuplicates.length > 0) {
        const latest = exactDuplicates[0];
        const timeDiff = Date.now() - latest.uploadDate.getTime();
        const hoursAgo = Math.floor(timeDiff / (1000 * 60 * 60));

        conflicts.push({
          type: CONFLICT_TYPES.DUPLICATE_UPLOAD,
          severity: hoursAgo < 1 ? 'critical' : 'warning',
          blocking: hoursAgo < 1,
          message: `Duplicate file uploaded ${hoursAgo} hours ago`,
          details: {
            previousUploadId: latest.id,
            previousUploadDate: latest.uploadDate,
            previousStatus: latest.status,
            itemCount: latest.itemCount
          },
          suggestedActions: [
            'Review previous upload results',
            'Cancel if duplicate',
            'Proceed if data has changed'
          ]
        });
      }
    } catch (error) {
      console.error('Error checking duplicate uploads:', error);
    }
  }

  /**
   * Check if supplier has an active price list that might conflict
   */
  async checkActivePriceList(upload, conflicts) {
    try {
      const activePriceLists = await db
        .select()
        .from(priceLists)
        .where(
          and(
            eq(priceLists.supplierId, upload.supplierId),
            eq(priceLists.status, 'active')
          )
        )
        .limit(5);

      if (activePriceLists.length > 0) {
        const latest = activePriceLists[0];
        const daysSinceActivation = Math.floor(
          (Date.now() - latest.effectiveDate.getTime()) / (1000 * 60 * 60 * 24)
        );

        // Only flag as conflict if recently activated (within 7 days)
        if (daysSinceActivation <= 7) {
          conflicts.push({
            type: CONFLICT_TYPES.ACTIVE_PRICE_LIST,
            severity: daysSinceActivation <= 1 ? 'high' : 'medium',
            blocking: false,
            message: `Active price list exists (activated ${daysSinceActivation} days ago)`,
            details: {
              activePriceListId: latest.id,
              activePriceListName: latest.name,
              effectiveDate: latest.effectiveDate,
              daysSinceActivation
            },
            suggestedActions: [
              'Review current active price list',
              'Consider scheduling upload for later',
              'Proceed to replace current list'
            ]
          });
        }
      }
    } catch (error) {
      console.error('Error checking active price lists:', error);
    }
  }

  /**
   * Check for other pending uploads from the same supplier
   */
  async checkPendingUploads(upload, conflicts) {
    try {
      const pendingUploads = await db
        .select()
        .from(uploadHistory)
        .where(
          and(
            eq(uploadHistory.supplierId, upload.supplierId),
            eq(uploadHistory.status, 'processing')
          )
        )
        .limit(10);

      if (pendingUploads.length > 0) {
        conflicts.push({
          type: CONFLICT_TYPES.PENDING_UPLOAD,
          severity: pendingUploads.length > 2 ? 'high' : 'medium',
          blocking: pendingUploads.length > 5,
          message: `${pendingUploads.length} pending upload(s) for this supplier`,
          details: {
            pendingCount: pendingUploads.length,
            pendingUploads: pendingUploads.map(upload => ({
              id: upload.id,
              fileName: upload.fileName,
              uploadDate: upload.uploadDate
            }))
          },
          suggestedActions: [
            'Wait for pending uploads to complete',
            'Cancel older pending uploads',
            'Increase priority if urgent'
          ]
        });
      }
    } catch (error) {
      console.error('Error checking pending uploads:', error);
    }
  }

  /**
   * Check for concurrent uploads from different users
   */
  async checkConcurrentUploads(upload, conflicts) {
    const lastFiveMinutes = new Date(Date.now() - 5 * 60 * 1000);
    
    try {
      const recentUploads = await db
        .select()
        .from(uploadHistory)
        .where(
          and(
            eq(uploadHistory.supplierId, upload.supplierId),
            gte(uploadHistory.uploadDate, lastFiveMinutes)
          )
        )
        .limit(10);

      const concurrentUploads = recentUploads.filter(recent => 
        recent.uploadedBy !== upload.userId
      );

      if (concurrentUploads.length > 0) {
        conflicts.push({
          type: CONFLICT_TYPES.CONCURRENT_UPLOAD,
          severity: 'medium',
          blocking: false,
          message: `${concurrentUploads.length} concurrent upload(s) detected`,
          details: {
            concurrentCount: concurrentUploads.length,
            timeWindow: '5 minutes',
            uploads: concurrentUploads.map(upload => ({
              id: upload.id,
              uploadedBy: upload.uploadedBy,
              fileName: upload.fileName,
              uploadDate: upload.uploadDate
            }))
          },
          suggestedActions: [
            'Coordinate with other users',
            'Wait for current uploads to complete',
            'Proceed with caution'
          ]
        });
      }
    } catch (error) {
      console.error('Error checking concurrent uploads:', error);
    }
  }

  /**
   * Check file size against limits
   */
  async checkFileSizeLimit(upload, conflicts) {
    const fileSize = upload.file.size;
    
    if (fileSize > this.maxFileSize) {
      conflicts.push({
        type: CONFLICT_TYPES.FILE_SIZE_LIMIT,
        severity: 'critical',
        blocking: true,
        message: `File size (${this.formatFileSize(fileSize)}) exceeds limit (${this.formatFileSize(this.maxFileSize)})`,
        details: {
          fileSize,
          maxFileSize: this.maxFileSize,
          fileName: upload.file.originalname
        },
        suggestedActions: [
          'Reduce file size',
          'Split into multiple files',
          'Contact administrator for limit increase'
        ]
      });
    } else if (fileSize > this.maxFileSize * 0.8) {
      // Warning if file is close to limit
      conflicts.push({
        type: CONFLICT_TYPES.FILE_SIZE_LIMIT,
        severity: 'warning',
        blocking: false,
        message: `Large file size (${this.formatFileSize(fileSize)}) may cause slow processing`,
        details: {
          fileSize,
          maxFileSize: this.maxFileSize,
          fileName: upload.file.originalname
        },
        suggestedActions: [
          'Consider optimizing file size',
          'Expect longer processing time',
          'Monitor upload progress'
        ]
      });
    }
  }

  /**
   * Check supplier status
   */
  async checkSupplierStatus(upload, conflicts) {
    try {
      const supplier = await db
        .select()
        .from(suppliers)
        .where(eq(suppliers.id, upload.supplierId))
        .limit(1);

      if (!supplier[0]) {
        conflicts.push({
          type: CONFLICT_TYPES.SUPPLIER_INACTIVE,
          severity: 'critical',
          blocking: true,
          message: 'Supplier not found',
          details: {
            supplierId: upload.supplierId
          },
          suggestedActions: [
            'Verify supplier ID',
            'Create supplier record first'
          ]
        });
      } else if (!supplier[0].isActive) {
        conflicts.push({
          type: CONFLICT_TYPES.SUPPLIER_INACTIVE,
          severity: 'high',
          blocking: true,
          message: 'Supplier is inactive',
          details: {
            supplierId: upload.supplierId,
            supplierName: supplier[0].companyName
          },
          suggestedActions: [
            'Activate supplier account',
            'Contact supplier management'
          ]
        });
      }
    } catch (error) {
      console.error('Error checking supplier status:', error);
    }
  }

  /**
   * Check rate limits
   */
  async checkRateLimit(upload, conflicts) {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    
    try {
      const [dailyUploads, hourlyUploads] = await Promise.all([
        db
          .select()
          .from(uploadHistory)
          .where(
            and(
              eq(uploadHistory.supplierId, upload.supplierId),
              gte(uploadHistory.uploadDate, oneDayAgo)
            )
          ),
        db
          .select()
          .from(uploadHistory)
          .where(
            and(
              eq(uploadHistory.supplierId, upload.supplierId),
              gte(uploadHistory.uploadDate, oneHourAgo)
            )
          )
      ]);

      if (dailyUploads.length >= this.maxDailyUploads) {
        conflicts.push({
          type: CONFLICT_TYPES.RATE_LIMIT,
          severity: 'high',
          blocking: true,
          message: `Daily upload limit reached (${dailyUploads.length}/${this.maxDailyUploads})`,
          details: {
            dailyCount: dailyUploads.length,
            maxDaily: this.maxDailyUploads,
            period: '24 hours'
          },
          suggestedActions: [
            'Wait until tomorrow',
            'Contact administrator for limit increase',
            'Consolidate multiple uploads'
          ]
        });
      }

      if (hourlyUploads.length >= this.maxHourlyUploads) {
        conflicts.push({
          type: CONFLICT_TYPES.RATE_LIMIT,
          severity: 'medium',
          blocking: false,
          message: `Hourly upload limit reached (${hourlyUploads.length}/${this.maxHourlyUploads})`,
          details: {
            hourlyCount: hourlyUploads.length,
            maxHourly: this.maxHourlyUploads,
            period: '1 hour'
          },
          suggestedActions: [
            'Wait 1 hour before uploading',
            'Queue upload with delay',
            'Increase upload priority'
          ]
        });
      }
    } catch (error) {
      console.error('Error checking rate limits:', error);
    }
  }

  /**
   * Check system maintenance mode
   */
  async checkMaintenanceMode(upload, conflicts) {
    if (this.maintenanceMode) {
      conflicts.push({
        type: CONFLICT_TYPES.MAINTENANCE_MODE,
        severity: 'critical',
        blocking: true,
        message: 'System is in maintenance mode',
        details: {
          maintenanceMode: true
        },
        suggestedActions: [
          'Wait for maintenance to complete',
          'Contact system administrator',
          'Try again later'
        ]
      });
    }
  }

  /**
   * Get suggested resolution strategy based on conflicts
   */
  getSuggestedResolution(conflicts) {
    if (conflicts.length === 0) {
      return {
        strategy: 'proceed',
        reason: 'No conflicts detected'
      };
    }

    // Check for critical blocking conflicts
    const criticalConflicts = conflicts.filter(c => c.severity === 'critical' && c.blocking);
    if (criticalConflicts.length > 0) {
      return {
        strategy: RESOLUTION_STRATEGIES.CANCEL_UPLOAD,
        reason: `Critical conflicts: ${criticalConflicts.map(c => c.type).join(', ')}`,
        conflicts: criticalConflicts
      };
    }

    // Check for high severity conflicts
    const highSeverityConflicts = conflicts.filter(c => c.severity === 'high');
    if (highSeverityConflicts.length > 0) {
      const hasRateLimit = highSeverityConflicts.some(c => c.type === CONFLICT_TYPES.RATE_LIMIT);
      const hasPendingUploads = highSeverityConflicts.some(c => c.type === CONFLICT_TYPES.PENDING_UPLOAD);
      
      if (hasRateLimit) {
        return {
          strategy: RESOLUTION_STRATEGIES.QUEUE_WITH_DELAY,
          reason: 'Rate limit exceeded - queue with delay',
          delayMinutes: 60,
          conflicts: highSeverityConflicts
        };
      }
      
      if (hasPendingUploads) {
        return {
          strategy: RESOLUTION_STRATEGIES.REQUEST_APPROVAL,
          reason: 'Multiple pending uploads - requires approval',
          conflicts: highSeverityConflicts
        };
      }
    }

    // For medium/warning conflicts, suggest proceeding with caution
    return {
      strategy: RESOLUTION_STRATEGIES.INCREASE_PRIORITY,
      reason: 'Minor conflicts detected - proceed with increased priority',
      priority: 'high',
      conflicts
    };
  }

  /**
   * Format file size for display
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Enable/disable maintenance mode
   */
  setMaintenanceMode(enabled) {
    this.maintenanceMode = enabled;
  }

  /**
   * Update rate limits
   */
  updateRateLimits(options) {
    if (options.maxDailyUploads) this.maxDailyUploads = options.maxDailyUploads;
    if (options.maxHourlyUploads) this.maxHourlyUploads = options.maxHourlyUploads;
    if (options.maxFileSize) this.maxFileSize = options.maxFileSize;
  }

  /**
   * Get current configuration
   */
  getConfiguration() {
    return {
      maxFileSize: this.maxFileSize,
      maxDailyUploads: this.maxDailyUploads,
      maxHourlyUploads: this.maxHourlyUploads,
      duplicateDetectionWindow: this.duplicateDetectionWindow,
      maintenanceMode: this.maintenanceMode
    };
  }
}

// Export default instance
export const defaultConflictDetector = new ConflictDetector();