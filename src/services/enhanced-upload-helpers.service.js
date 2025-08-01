/**
 * Enhanced Upload Helpers Service
 * Implements missing helper methods for the supplier upload enhancement
 */

import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

export class EnhancedUploadHelpersService {
  constructor() {
    this.tempDir = process.env.UPLOAD_TEMP_DIR || './temp/uploads';
    this.maxFileSize = 50 * 1024 * 1024; // 50MB
  }

  /**
   * Generate unique upload ID
   */
  generateUploadId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 9);
    return `upload_${timestamp}_${random}`;
  }

  /**
   * Calculate file hash for duplicate detection
   */
  async calculateFileHash(filePath) {
    try {
      const fileBuffer = await fs.readFile(filePath);
      return createHash('sha256').update(fileBuffer).digest('hex');
    } catch (error) {
      console.error('Error calculating file hash:', error);
      return null;
    }
  }

  /**
   * Validate file size and type
   */
  validateFile(file) {
    const errors = [];
    
    // Check file size
    if (file.size > this.maxFileSize) {
      errors.push(`File too large: ${(file.size / 1024 / 1024).toFixed(2)}MB (max: 50MB)`);
    }
    
    // Check file type
    const allowedTypes = [
      'text/csv',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/json',
      'application/xml',
      'message/rfc822'
    ];
    
    if (!allowedTypes.includes(file.mimetype)) {
      errors.push(`Unsupported file type: ${file.mimetype}`);
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Create upload session for tracking
   */
  async createUploadSession(uploadId, supplierId) {
    const sessionId = this.generateUploadId();
    
    // In a real implementation, this would save to database
    // For now, return mock session data
    return {
      sessionId,
      uploadId,
      supplierId,
      status: 'active',
      progress: 0,
      startTime: new Date(),
      steps: [
        'File validation',
        'Data extraction',
        'Price rules application',
        'Validation checks',
        'Database updates',
        'Notifications'
      ]
    };
  }

  /**
   * Update upload progress
   */
  async updateUploadProgress(sessionId, progress, currentStep, message = '') {
    // In a real implementation, this would update database and WebSocket
    console.log(`Upload ${sessionId}: ${progress}% - ${currentStep} - ${message}`);
    
    return {
      sessionId,
      progress,
      currentStep,
      message,
      timestamp: new Date()
    };
  }

  /**
   * Clean up temporary files
   */
  async cleanupTempFiles(filePaths) {
    const cleanupPromises = filePaths.map(async (filePath) => {
      try {
        await fs.unlink(filePath);
        console.log(`Cleaned up temp file: ${filePath}`);
      } catch (error) {
        console.warn(`Failed to cleanup temp file ${filePath}:`, error.message);
      }
    });
    
    await Promise.allSettled(cleanupPromises);
  }

  /**
   * Generate upload summary
   */
  generateUploadSummary(validationResults, processedData) {
    const totalItems = processedData.length;
    const validItems = validationResults.validData?.length || 0;
    const errorCount = validationResults.criticalErrors?.length || 0;
    const warningCount = validationResults.warnings?.length || 0;
    
    // Calculate estimated value
    const estimatedValue = processedData.reduce((sum, item) => {
      const price = parseFloat(item.unitPrice) || 0;
      const quantity = parseInt(item.minimumOrderQuantity) || 1;
      return sum + (price * quantity);
    }, 0);
    
    return {
      totalItems,
      validItems,
      invalidItems: totalItems - validItems,
      newItems: validItems, // Simplified - would need duplicate checking
      updatedItems: 0,
      duplicateItems: 0,
      errorCount,
      warningCount,
      estimatedValue,
      processingTime: 0, // Would be calculated from actual processing
      success: errorCount === 0
    };
  }

  /**
   * Format error messages for user display
   */
  formatErrorsForDisplay(errors) {
    return errors.map(error => {
      if (typeof error === 'string') {
        return { message: error, type: 'error' };
      }
      return {
        message: error.message || error.toString(),
        type: error.type || 'error',
        row: error.row || null,
        field: error.field || null
      };
    });
  }

  /**
   * Generate preview data for approval
   */
  generatePreviewData(processedData, validationResults, limit = 10) {
    const previewItems = processedData.slice(0, limit).map(item => ({
      sku: item.sku,
      description: item.description,
      unitPrice: item.unitPrice,
      category: item.category,
      minimumOrderQuantity: item.minimumOrderQuantity,
      status: 'preview'
    }));
    
    return {
      preview: previewItems,
      totalItems: processedData.length,
      showing: Math.min(limit, processedData.length),
      summary: this.generateUploadSummary(validationResults, processedData),
      validationSummary: {
        errors: validationResults.criticalErrors?.length || 0,
        warnings: validationResults.warnings?.length || 0,
        valid: validationResults.validData?.length || 0
      }
    };
  }

  /**
   * Check for duplicate uploads
   */
  async checkForDuplicates(fileHash, supplierId) {
    // In a real implementation, this would query the database
    // For now, return mock data
    return {
      isDuplicate: false,
      duplicateUploadId: null,
      duplicateDate: null
    };
  }

  /**
   * Save upload to history
   */
  async saveUploadHistory(uploadData) {
    // In a real implementation, this would save to upload_history table
    console.log('Saving upload history:', uploadData.uploadId);
    
    return {
      id: this.generateUploadId(),
      ...uploadData,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }

  /**
   * Get upload statistics
   */
  async getUploadStatistics() {
    // Mock statistics - in real implementation would query database
    return {
      service: {
        totalUploads: 156,
        successRate: 94.8,
        averageProcessingTime: 2340, // milliseconds
        totalFilesProcessed: 156
      },
      database: {
        totalUploads: 1245,
        totalItemsProcessed: 45678,
        averageItemsPerUpload: 293
      },
      performance: {
        averageResponseTime: 1.2,
        cacheHitRate: 87.3,
        errorRate: 2.1
      }
    };
  }

  /**
   * Intelligent column mapping suggestions
   */
  suggestColumnMapping(headers, knownMappings = {}) {
    const commonMappings = {
      'sku': ['sku', 'product_code', 'item_code', 'code', 'part_number'],
      'unitPrice': ['price', 'unit_price', 'cost', 'unitprice', 'unit_cost'],
      'description': ['description', 'name', 'product_name', 'title', 'desc'],
      'category': ['category', 'cat', 'type', 'group', 'classification'],
      'minimumOrderQuantity': ['moq', 'min_qty', 'minimum_quantity', 'min_order']
    };
    
    const suggestions = {};
    
    headers.forEach(header => {
      const lowerHeader = header.toLowerCase().replace(/[^a-z0-9]/g, '_');
      
      for (const [field, patterns] of Object.entries(commonMappings)) {
        if (patterns.some(pattern => lowerHeader.includes(pattern))) {
          suggestions[header] = field;
          break;
        }
      }
    });
    
    return {
      suggestions,
      confidence: Object.keys(suggestions).length / headers.length,
      unmapped: headers.filter(h => !suggestions[h])
    };
  }
}

export const enhancedUploadHelpersService = new EnhancedUploadHelpersService();
export default enhancedUploadHelpersService;