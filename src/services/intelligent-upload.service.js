import { parsePriceListFile } from '../utils/file-parsers/index.js';
import { businessRules } from './business-rules.service.js';
import { uploadQueue } from './upload-queue.service.js';
import { priceListService } from './price-list.service.js';
import { supplierService } from './supplier.service.js';
import { inventoryService } from './inventory.service.js';
import { IntelligentColumnMapper } from '../utils/file-parsers/intelligent-column-mapper.js';
import WebSocket from 'ws';

// Enhanced upload service with intelligent parsing
export class IntelligentUploadService {
  constructor() {
    this.columnMapper = new IntelligentColumnMapper({
      fuzzyThreshold: 0.7,
      useML: true,
      usePatterns: true
    });
    
    this.uploadStats = {
      totalProcessed: 0,
      successCount: 0,
      errorCount: 0,
      learningData: []
    };
  }
  
  // Process file upload with intelligent parsing
  async processUpload(file, supplierId, userId, options = {}) {
    const uploadId = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      // Validate file
      const fileValidation = businessRules.validateUploadFile(file);
      if (!fileValidation.valid) {
        return {
          success: false,
          uploadId,
          errors: fileValidation.errors
        };
      }
      
      // Check supplier status
      const supplier = await supplierService.getSupplierById(supplierId);
      const supplierValidation = businessRules.validateSupplierStatus(supplier);
      
      if (!supplierValidation.active) {
        return {
          success: false,
          uploadId,
          errors: [`Supplier is not active: ${supplierValidation.warnings.join(', ')}`]
        };
      }
      
      // Queue the upload for processing
      const jobId = await uploadQueue.addUploadJob({
        uploadId,
        file,
        supplierId,
        userId,
        options: {
          ...options,
          intelligentParsing: true,
          intelligentMapping: true,
          columnMapper: this.columnMapper
        }
      });
      
      // Process immediately if queue is available
      this.processQueuedUpload(jobId, uploadId);
      
      return {
        success: true,
        uploadId,
        jobId,
        status: 'queued',
        message: 'Upload queued for intelligent processing'
      };
      
    } catch (error) {
      console.error('Upload processing error:', error);
      return {
        success: false,
        uploadId,
        error: error.message
      };
    }
  }
  
  // Process queued upload with intelligent features
  async processQueuedUpload(jobId, uploadId) {
    try {
      const job = await uploadQueue.getJob(jobId);
      if (!job) throw new Error('Job not found');
      
      const { file, supplierId, userId, options } = job.data;
      
      // Update status
      await this.updateUploadStatus(uploadId, 'parsing', { step: 'Intelligent parsing started' });
      
      // Parse file with intelligent features
      const parseResult = await parsePriceListFile(file, options);
      
      if (!parseResult.success) {
        await this.updateUploadStatus(uploadId, 'failed', { 
          error: parseResult.error,
          step: 'Parsing failed'
        });
        return;
      }
      
      // Get mapped data or apply mapping
      let mappedData = parseResult.mappedData || parseResult.data;
      
      // If no mapping was done but we have headers, try mapping
      if (!parseResult.mappedData && parseResult.headers && Array.isArray(parseResult.data)) {
        await this.updateUploadStatus(uploadId, 'mapping', { 
          step: 'Applying intelligent column mapping',
          headers: parseResult.headers
        });
        
        const mappingResult = this.columnMapper.mapHeaders(parseResult.headers);
        
        // Validate mapping
        const mappingValidation = this.columnMapper.validateMapping(
          parseResult.data,
          mappingResult.mapping
        );
        
        if (!mappingValidation.valid) {
          await this.updateUploadStatus(uploadId, 'needs_review', {
            step: 'Mapping requires manual review',
            errors: mappingValidation.errors,
            suggestions: mappingResult.suggestions,
            unmappedHeaders: mappingResult.unmappedHeaders
          });
          return;
        }
        
        mappedData = this.columnMapper.applyMapping(parseResult.data, mappingResult.mapping);
        
        // Store mapping confidence for learning
        this.recordMappingSuccess(parseResult.headers, mappingResult.mapping, mappingResult.confidence);
      }
      
      // Validate items with business rules
      await this.updateUploadStatus(uploadId, 'validating', { 
        step: 'Validating items with business rules',
        itemCount: mappedData.length
      });
      
      const validationResults = await this.validateItems(mappedData, supplierId);
      
      if (validationResults.errors.length > 0 && validationResults.validItems.length === 0) {
        await this.updateUploadStatus(uploadId, 'failed', {
          step: 'Validation failed',
          errors: validationResults.errors,
          warnings: validationResults.warnings
        });
        return;
      }
      
      // Check for duplicates
      await this.updateUploadStatus(uploadId, 'checking_duplicates', { 
        step: 'Checking for duplicate SKUs'
      });
      
      const existingItems = await priceListService.getActiveItemsBySupplierId(supplierId);
      const duplicateCheck = await businessRules.checkDuplicateSKUs(
        validationResults.validItems,
        existingItems
      );
      
      if (duplicateCheck.hasDuplicates) {
        await this.updateUploadStatus(uploadId, 'needs_review', {
          step: 'Duplicate SKUs found',
          duplicates: duplicateCheck.duplicates,
          validItems: validationResults.validItems,
          requiresAction: 'resolve_duplicates'
        });
        return;
      }
      
      // Create price list
      await this.updateUploadStatus(uploadId, 'creating_price_list', { 
        step: 'Creating price list record'
      });
      
      const priceListData = {
        supplierId,
        name: `Price List - ${new Date().toISOString().split('T')[0]}`,
        description: `Uploaded from ${file.filename} via intelligent parser`,
        effectiveDate: options.effectiveDate || new Date(),
        currency: this.detectCurrency(validationResults.validItems),
        uploadedBy: userId,
        metadata: {
          uploadId,
          fileType: parseResult.fileType,
          parsingMethod: parseResult.fileType === 'INTELLIGENT_PDF' ? 'OCR + AI' : 'Standard',
          mappingConfidence: parseResult.mappingConfidence,
          itemCount: validationResults.validItems.length,
          warningCount: validationResults.warnings.length
        }
      };
      
      // Check approval requirements
      const approvalCheck = businessRules.determineApprovalRequired(
        priceListData,
        validationResults.validItems
      );
      
      priceListData.status = approvalCheck.autoApprove ? 'active' : 'pending_approval';
      priceListData.approvalRequired = approvalCheck.required;
      priceListData.approvalReasons = approvalCheck.reasons;
      
      // Save price list
      const priceList = await priceListService.createPriceList(
        priceListData,
        validationResults.validItems
      );
      
      // Update inventory costs if auto-approved
      if (priceList.status === 'active') {
        await this.updateUploadStatus(uploadId, 'updating_inventory', { 
          step: 'Updating inventory costs'
        });
        
        await this.updateInventoryCosts(priceList.id, validationResults.validItems);
      }
      
      // Final status update
      await this.updateUploadStatus(uploadId, 'completed', {
        step: 'Upload completed successfully',
        priceListId: priceList.id,
        status: priceList.status,
        itemsProcessed: validationResults.validItems.length,
        warningsCount: validationResults.warnings.length,
        requiresApproval: approvalCheck.required
      });
      
      // Update stats
      this.updateStats(true, parseResult, validationResults);
      
    } catch (error) {
      console.error('Queue processing error:', error);
      await this.updateUploadStatus(uploadId, 'failed', {
        step: 'Processing failed',
        error: error.message
      });
      this.updateStats(false);
    }
  }
  
  // Validate items with business rules
  async validateItems(items, supplierId) {
    const validItems = [];
    const errors = [];
    const warnings = [];
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const validation = businessRules.validatePriceListItem(item);
      
      if (validation.valid) {
        validItems.push({
          ...validation.normalizedItem,
          supplierId,
          rowNumber: i + 1
        });
        
        if (validation.warnings.length > 0) {
          warnings.push({
            row: i + 1,
            sku: item.sku,
            warnings: validation.warnings
          });
        }
      } else {
        errors.push({
          row: i + 1,
          sku: item.sku || 'UNKNOWN',
          errors: validation.errors
        });
      }
    }
    
    return {
      validItems,
      errors,
      warnings,
      totalProcessed: items.length,
      successRate: (validItems.length / items.length) * 100
    };
  }
  
  // Update inventory costs based on new price list
  async updateInventoryCosts(priceListId, items) {
    const updateResults = {
      updated: 0,
      notFound: 0,
      errors: 0
    };
    
    for (const item of items) {
      try {
        const inventoryItem = await inventoryService.getItemBySKU(item.sku);
        
        if (inventoryItem) {
          await inventoryService.updateCost(inventoryItem.id, {
            unitCost: item.unitPrice,
            currency: item.currency,
            lastCostUpdate: new Date(),
            priceListId: priceListId,
            supplierId: item.supplierId
          });
          updateResults.updated++;
        } else {
          updateResults.notFound++;
        }
      } catch (error) {
        console.error(`Error updating cost for SKU ${item.sku}:`, error);
        updateResults.errors++;
      }
    }
    
    return updateResults;
  }
  
  // Detect currency from items
  detectCurrency(items) {
    const currencies = items
      .map(item => item.currency)
      .filter(Boolean);
    
    if (currencies.length === 0) return 'USD';
    
    // Find most common currency
    const currencyCount = {};
    currencies.forEach(currency => {
      currencyCount[currency] = (currencyCount[currency] || 0) + 1;
    });
    
    return Object.entries(currencyCount)
      .sort((a, b) => b[1] - a[1])[0][0];
  }
  
  // Update upload status with WebSocket notifications
  async updateUploadStatus(uploadId, status, details = {}) {
    const statusUpdate = {
      uploadId,
      status,
      timestamp: new Date(),
      ...details
    };
    
    // Store in database/cache
    await this.storeUploadStatus(uploadId, statusUpdate);
    
    // Send WebSocket notification
    this.broadcastStatus(statusUpdate);
    
    return statusUpdate;
  }
  
  // Store upload status (implement based on your storage solution)
  async storeUploadStatus(uploadId, status) {
    // This would typically store in Redis or database
    // For now, just log it
    console.log(`Upload ${uploadId} status:`, status);
  }
  
  // Broadcast status via WebSocket
  broadcastStatus(status) {
    // This would integrate with your WebSocket server
    // Example implementation:
    if (global.wss) {
      global.wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            type: 'upload_status',
            data: status
          }));
        }
      });
    }
  }
  
  // Record successful mappings for ML improvement
  recordMappingSuccess(headers, mapping, confidence) {
    headers.forEach((header, index) => {
      const mappedField = Object.entries(mapping).find(([field, idx]) => idx === index);
      
      if (mappedField) {
        const [field, _] = mappedField;
        this.columnMapper.learnFromFeedback(header, field, true);
        
        this.uploadStats.learningData.push({
          header,
          field,
          confidence: confidence[field],
          timestamp: new Date()
        });
      }
    });
  }
  
  // Update service statistics
  updateStats(success, parseResult = null, validationResults = null) {
    this.uploadStats.totalProcessed++;
    
    if (success) {
      this.uploadStats.successCount++;
    } else {
      this.uploadStats.errorCount++;
    }
    
    // Could send to monitoring service
    console.log('Upload stats:', {
      ...this.uploadStats,
      successRate: (this.uploadStats.successCount / this.uploadStats.totalProcessed) * 100
    });
  }
  
  // Get column mapping learnings
  getLearnings() {
    return this.columnMapper.exportLearnings();
  }
  
  // Import previous learnings
  importLearnings(data) {
    this.columnMapper.importLearnings(data);
  }
  
  // Handle manual mapping corrections
  async correctMapping(uploadId, corrections) {
    // Apply corrections and learn from them
    corrections.forEach(({ header, field, isCorrect }) => {
      this.columnMapper.learnFromFeedback(header, field, isCorrect);
    });
    
    // Re-process the upload with corrected mappings
    // Implementation depends on your storage solution
  }
}

// Export singleton instance
export const intelligentUploadService = new IntelligentUploadService();