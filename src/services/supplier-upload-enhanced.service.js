import { EventEmitter } from 'events';
// Import upload service with fallback for compatibility
import { UploadService } from './upload.service.js';
import { intelligentUploadService } from './intelligent-upload.service.js';
import { priceRulesEngine } from './price-rules-engine.service.js';
import { supplierNotificationService } from './supplier-notification.service.js';
import { priceListVersionService } from './price-list-version.service.js';
import { supplierValidationService } from './supplier-validation.service.js';
import { parsePriceListFile, validatePriceListFile } from '../utils/file-parsers/index.js';
import { createUploadHistoryRecord, updateUploadHistoryStatus } from '../db/upload-history-queries.js';
import { getSupplierById } from '../db/supplier-queries.js';
import { createPriceList, createPriceListItems } from '../db/price-list-queries.js';

/**
 * Enhanced Supplier Price List Upload Service
 * Provides comprehensive upload functionality with:
 * - Multi-format file support (CSV, Excel, PDF, Word, Email)
 * - Intelligent data extraction and validation
 * - Price rules engine (markups, discounts, tiers)
 * - Real-time preview before import
 * - Bulk update capabilities
 * - Error handling with detailed feedback
 * - Version control for price lists
 * - Automated supplier notifications
 */
export class SupplierUploadEnhancedService extends EventEmitter {
  constructor() {
    super();
    this.uploadService = new UploadService();
    this.intelligentService = intelligentUploadService;
    this.priceRules = priceRulesEngine;
    this.notifications = supplierNotificationService;
    this.versionControl = priceListVersionService;
    this.validator = supplierValidationService;

    // Service statistics
    this.stats = {
      totalUploads: 0,
      successfulUploads: 0,
      failedUploads: 0,
      averageProcessingTime: 0,
      formatStats: {
        csv: 0,
        excel: 0,
        pdf: 0,
        word: 0,
        email: 0,
        json: 0,
        xml: 0
      }
    };

    this.setupEventHandlers();
  }

  /**
   * Setup event handlers for upload coordination
   */
  setupEventHandlers() {
    // Forward events from upload service
    this.uploadService.on('upload:completed', (data) => {
      this.emit('upload:completed', data);
      this.updateStats('success', data);
    });

    this.uploadService.on('upload:failed', (data) => {
      this.emit('upload:failed', data);
      this.updateStats('failure', data);
    });

    this.uploadService.on('upload:progress', (data) => {
      this.emit('upload:progress', data);
    });
  }

  /**
   * Enhanced upload price list with comprehensive features
   */
  async uploadPriceList(uploadData) {
    const startTime = Date.now();
    const uploadId = `enhanced_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      const {
        file,
        supplierId,
        userId,
        options = {}
      } = uploadData;

      // Enhanced options with defaults
      const enhancedOptions = {
        // Format detection and parsing
        intelligentParsing: options.intelligentParsing !== false,
        autoDetectFormat: options.autoDetectFormat !== false,
        
        // Validation options
        strictValidation: options.strictValidation !== false,
        businessRulesValidation: options.businessRulesValidation !== false,
        duplicateHandling: options.duplicateHandling || 'warn', // 'skip', 'overwrite', 'warn', 'merge'
        
        // Price rules
        applyPriceRules: options.applyPriceRules !== false,
        priceRulesConfig: options.priceRulesConfig || {},
        
        // Preview and approval
        requirePreview: options.requirePreview !== false,
        requireApproval: options.requireApproval !== false,
        autoActivate: options.autoActivate === true,
        
        // Version control
        createNewVersion: options.createNewVersion !== false,
        replaceExisting: options.replaceExisting === true,
        
        // Notifications
        notifySupplier: options.notifySupplier !== false,
        notifyApprovers: options.notifyApprovers !== false,
        
        // Processing
        batchSize: options.batchSize || 100,
        maxErrors: options.maxErrors || 50,
        
        ...options
      };

      // Create upload history record
      const uploadRecord = await createUploadHistoryRecord({
        uploadId,
        supplierId,
        fileName: file.originalname || file.name,
        fileType: this.detectFileType(file),
        fileSize: file.size,
        uploadedBy: userId,
        status: 'processing',
        processingOptions: enhancedOptions
      });

      this.emit('upload:started', { uploadId, supplierId, fileName: file.originalname });

      // Step 1: Validate supplier and permissions
      await this.updateUploadStatus(uploadId, 'validating_supplier', 'Validating supplier and permissions');
      const supplierValidation = await this.validateSupplierAndPermissions(supplierId, userId);
      
      if (!supplierValidation.valid) {
        await this.failUpload(uploadId, 'Supplier validation failed', supplierValidation.errors);
        return { success: false, uploadId, errors: supplierValidation.errors };
      }

      // Step 2: Validate and parse file
      await this.updateUploadStatus(uploadId, 'parsing_file', 'Parsing and validating file format');
      const parseResult = await this.parseAndValidateFile(file, enhancedOptions);
      
      if (!parseResult.success) {
        await this.failUpload(uploadId, 'File parsing failed', parseResult.errors);
        return { success: false, uploadId, errors: parseResult.errors };
      }

      // Step 3: Apply intelligent column mapping
      await this.updateUploadStatus(uploadId, 'mapping_columns', 'Applying intelligent column mapping');
      const mappingResult = await this.applyIntelligentMapping(parseResult.data, enhancedOptions);
      
      if (!mappingResult.success && enhancedOptions.requirePreview) {
        await this.updateUploadStatus(uploadId, 'requires_mapping_review', 'Manual column mapping required');
        return {
          success: false,
          uploadId,
          requiresReview: true,
          mappingOptions: mappingResult.suggestions,
          preview: parseResult.preview
        };
      }

      // Step 4: Validate business rules
      await this.updateUploadStatus(uploadId, 'validating_data', 'Validating data against business rules');
      const validationResult = await this.validateBusinessRules(mappingResult.data, supplierId, enhancedOptions);
      
      if (validationResult.criticalErrors.length > 0) {
        await this.failUpload(uploadId, 'Critical validation errors', validationResult.criticalErrors);
        return { 
          success: false, 
          uploadId, 
          errors: validationResult.criticalErrors,
          warnings: validationResult.warnings
        };
      }

      // Step 5: Handle duplicates
      await this.updateUploadStatus(uploadId, 'checking_duplicates', 'Checking for duplicate items');
      const duplicateResult = await this.handleDuplicates(validationResult.validData, supplierId, enhancedOptions);
      
      if (duplicateResult.requiresDecision && enhancedOptions.requirePreview) {
        await this.updateUploadStatus(uploadId, 'requires_duplicate_resolution', 'Duplicate resolution required');
        return {
          success: false,
          uploadId,
          requiresReview: true,
          duplicates: duplicateResult.duplicates,
          resolutionOptions: duplicateResult.options
        };
      }

      // Step 6: Apply price rules
      await this.updateUploadStatus(uploadId, 'applying_price_rules', 'Applying price rules and calculations');
      const priceRulesResult = await this.applyPriceRules(duplicateResult.finalData, enhancedOptions.priceRulesConfig);
      
      // Step 7: Generate preview if required
      if (enhancedOptions.requirePreview && !enhancedOptions.skipPreview) {
        await this.updateUploadStatus(uploadId, 'generating_preview', 'Generating import preview');
        const preview = await this.generateImportPreview(priceRulesResult.data, supplierValidation.supplier);
        
        await this.updateUploadStatus(uploadId, 'waiting_for_approval', 'Waiting for user approval');
        return {
          success: true,
          uploadId,
          requiresApproval: true,
          preview,
          summary: {
            totalItems: priceRulesResult.data.length,
            newItems: priceRulesResult.summary.newItems,
            updatedItems: priceRulesResult.summary.updatedItems,
            warnings: validationResult.warnings.length,
            estimatedValue: priceRulesResult.summary.totalValue
          }
        };
      }

      // Step 8: Create price list and items
      const importResult = await this.executeImport(
        priceRulesResult.data,
        supplierValidation.supplier,
        userId,
        enhancedOptions,
        uploadId
      );

      // Step 9: Post-processing and notifications
      await this.handlePostProcessing(importResult, enhancedOptions, uploadId);

      const processingTime = Date.now() - startTime;
      await this.updateUploadStatus(uploadId, 'completed', 'Upload completed successfully', {
        processingTime,
        itemsProcessed: importResult.itemsCreated,
        priceListId: importResult.priceListId
      });

      this.updateStats('success', { processingTime, format: parseResult.format });

      return {
        success: true,
        uploadId,
        priceListId: importResult.priceListId,
        itemsProcessed: importResult.itemsCreated,
        processingTime,
        summary: importResult.summary
      };

    } catch (error) {
      console.error('Enhanced upload error:', error);
      await this.failUpload(uploadId, 'System error during upload', [error.message]);
      this.updateStats('failure', { processingTime: Date.now() - startTime });
      
      return {
        success: false,
        uploadId,
        error: error.message
      };
    }
  }

  /**
   * Approve and execute a pending upload
   */
  async approveUpload(uploadId, approvalData, userId) {
    try {
      const { 
        mappingOverrides = {},
        duplicateResolutions = {},
        priceRuleOverrides = {},
        comments = null
      } = approvalData;

      await this.updateUploadStatus(uploadId, 'processing_approval', 'Processing approval and executing import');

      // Get upload data from temporary storage
      const uploadData = await this.getUploadData(uploadId);
      if (!uploadData) {
        throw new Error('Upload data not found or expired');
      }

      // Apply any manual overrides
      let finalData = uploadData.processedData;
      
      if (Object.keys(mappingOverrides).length > 0) {
        finalData = await this.applyMappingOverrides(finalData, mappingOverrides);
      }
      
      if (Object.keys(duplicateResolutions).length > 0) {
        finalData = await this.applyDuplicateResolutions(finalData, duplicateResolutions);
      }
      
      if (Object.keys(priceRuleOverrides).length > 0) {
        finalData = await this.applyPriceRuleOverrides(finalData, priceRuleOverrides);
      }

      // Execute the final import
      const importResult = await this.executeImport(
        finalData,
        uploadData.supplier,
        userId,
        uploadData.options,
        uploadId
      );

      await this.updateUploadStatus(uploadId, 'completed', 'Upload approved and completed', {
        approvedBy: userId,
        approvalComments: comments,
        itemsProcessed: importResult.itemsCreated,
        priceListId: importResult.priceListId
      });

      // Clean up temporary data
      await this.cleanupUploadData(uploadId);

      return {
        success: true,
        priceListId: importResult.priceListId,
        itemsProcessed: importResult.itemsCreated,
        summary: importResult.summary
      };

    } catch (error) {
      await this.failUpload(uploadId, 'Approval processing failed', [error.message]);
      throw error;
    }
  }

  /**
   * Get upload preview for review
   */
  async getUploadPreview(uploadId) {
    try {
      const uploadData = await this.getUploadData(uploadId);
      if (!uploadData) {
        return { success: false, error: 'Upload data not found or expired' };
      }

      const preview = await this.generateImportPreview(uploadData.processedData, uploadData.supplier);
      
      return {
        success: true,
        preview,
        uploadInfo: {
          fileName: uploadData.fileName,
          fileType: uploadData.fileType,
          uploadedAt: uploadData.uploadedAt,
          supplier: uploadData.supplier.companyName
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Bulk upload multiple price lists
   */
  async bulkUpload(uploadDataArray, userId) {
    const results = [];
    const batchId = `bulk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    this.emit('bulk:started', { batchId, count: uploadDataArray.length });

    for (let i = 0; i < uploadDataArray.length; i++) {
      const uploadData = uploadDataArray[i];
      
      try {
        this.emit('bulk:progress', { batchId, current: i + 1, total: uploadDataArray.length });
        
        const result = await this.uploadPriceList({
          ...uploadData,
          options: {
            ...uploadData.options,
            requirePreview: false, // Skip preview for bulk operations
            batchId
          }
        });
        
        results.push({ index: i, success: true, ...result });
      } catch (error) {
        results.push({ 
          index: i, 
          success: false, 
          error: error.message,
          supplierId: uploadData.supplierId,
          fileName: uploadData.file.originalname 
        });
      }
    }

    const summary = {
      total: uploadDataArray.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      batchId
    };

    this.emit('bulk:completed', { batchId, summary, results });

    return { success: true, summary, results };
  }

  /**
   * Cancel an upload
   */
  async cancelUpload(uploadId, reason, userId) {
    try {
      await this.updateUploadStatus(uploadId, 'cancelled', reason, { cancelledBy: userId });
      await this.cleanupUploadData(uploadId);
      
      return { success: true, message: 'Upload cancelled successfully' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get upload status and progress
   */
  async getUploadStatus(uploadId) {
    try {
      // Get from upload service first
      const uploadServiceStatus = this.uploadService.getUploadStatus(uploadId);
      
      if (uploadServiceStatus) {
        return uploadServiceStatus;
      }

      // Get from our enhanced tracking
      const uploadData = await this.getUploadData(uploadId);
      if (uploadData) {
        return {
          uploadId,
          status: uploadData.status,
          progress: uploadData.progress || 0,
          message: uploadData.message,
          errors: uploadData.errors || [],
          warnings: uploadData.warnings || [],
          startTime: uploadData.startTime,
          estimatedCompletion: uploadData.estimatedCompletion
        };
      }

      return { success: false, error: 'Upload not found' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ====================
  // HELPER METHODS
  // ====================

  /**
   * Validate supplier and user permissions
   */
  async validateSupplierAndPermissions(supplierId, userId) {
    try {
      const supplier = await getSupplierById(supplierId);
      
      if (!supplier) {
        return { valid: false, errors: ['Supplier not found'] };
      }
      
      if (!supplier.isActive) {
        return { valid: false, errors: ['Supplier is inactive'] };
      }

      // TODO: Add user permission checks
      // const permissions = await checkUserPermissions(userId, 'supplier_upload', supplierId);
      // if (!permissions.canUpload) {
      //   return { valid: false, errors: ['Insufficient permissions to upload price lists'] };
      // }

      return { valid: true, supplier };
    } catch (error) {
      return { valid: false, errors: [error.message] };
    }
  }

  /**
   * Parse and validate file
   */
  async parseAndValidateFile(file, options) {
    try {
      // Validate file first
      const validation = await validatePriceListFile(file, options);
      if (!validation.valid) {
        return { success: false, errors: [validation.error] };
      }

      // Parse file with enhanced options
      const parseResult = await parsePriceListFile(file, {
        ...options,
        intelligentParsing: true,
        generatePreview: true
      });

      if (!parseResult.success) {
        return { success: false, errors: [parseResult.error] };
      }

      return {
        success: true,
        data: parseResult.data,
        headers: parseResult.headers,
        format: parseResult.fileType,
        preview: parseResult.data.slice(0, 5), // First 5 rows for preview
        totalRows: parseResult.data.length
      };
    } catch (error) {
      return { success: false, errors: [error.message] };
    }
  }

  /**
   * Apply intelligent column mapping
   */
  async applyIntelligentMapping(data, options) {
    if (!options.intelligentMapping || !Array.isArray(data) || data.length === 0) {
      return { success: true, data };
    }

    try {
      return await this.intelligentService.applyColumnMapping(data, options);
    } catch (error) {
      return { 
        success: false, 
        error: error.message,
        suggestions: await this.generateMappingSuggestions(data)
      };
    }
  }

  /**
   * Validate business rules
   */
  async validateBusinessRules(data, supplierId, options) {
    try {
      return await this.validator.validatePriceListData(data, {
        supplierId,
        strictMode: options.strictValidation,
        maxErrors: options.maxErrors
      });
    } catch (error) {
      return {
        criticalErrors: [error.message],
        warnings: [],
        validData: []
      };
    }
  }

  /**
   * Handle duplicate items
   */
  async handleDuplicates(data, supplierId, options) {
    const duplicateHandling = options.duplicateHandling || 'warn';
    
    // Find existing items
    const existingItems = await this.getExistingSupplierItems(supplierId);
    const existingSkus = new Set(existingItems.map(item => item.sku));
    
    const duplicates = [];
    const newItems = [];
    
    data.forEach(item => {
      if (existingSkus.has(item.sku)) {
        duplicates.push({
          sku: item.sku,
          existing: existingItems.find(e => e.sku === item.sku),
          new: item
        });
      } else {
        newItems.push(item);
      }
    });

    if (duplicates.length === 0) {
      return { requiresDecision: false, finalData: data };
    }

    switch (duplicateHandling) {
      case 'skip':
        return { requiresDecision: false, finalData: newItems };
      
      case 'overwrite':
        return { requiresDecision: false, finalData: data };
      
      case 'merge':
        const mergedData = await this.mergeDuplicates(duplicates, newItems);
        return { requiresDecision: false, finalData: mergedData };
      
      case 'warn':
      default:
        return {
          requiresDecision: true,
          duplicates,
          options: ['skip', 'overwrite', 'merge'],
          finalData: data
        };
    }
  }

  /**
   * Apply price rules engine
   */
  async applyPriceRules(data, rulesConfig) {
    try {
      return await this.priceRules.applyRules(data, rulesConfig);
    } catch (error) {
      return {
        data,
        summary: { newItems: data.length, updatedItems: 0, totalValue: 0 },
        errors: [error.message]
      };
    }
  }

  /**
   * Generate import preview
   */
  async generateImportPreview(data, supplier) {
    const preview = {
      supplier: {
        id: supplier.id,
        name: supplier.companyName,
        code: supplier.supplierCode
      },
      summary: {
        totalItems: data.length,
        estimatedValue: data.reduce((sum, item) => sum + (item.unitPrice * (item.minimumOrderQuantity || 1)), 0),
        currencies: [...new Set(data.map(item => item.currency))],
        categories: [...new Set(data.map(item => item.category).filter(Boolean))]
      },
      sampleItems: data.slice(0, 10),
      priceDistribution: this.calculatePriceDistribution(data),
      validationSummary: {
        validItems: data.length,
        warnings: 0,
        errors: 0
      }
    };

    return preview;
  }

  /**
   * Execute the final import
   */
  async executeImport(data, supplier, userId, options, uploadId) {
    try {
      // Create price list
      const priceListData = {
        supplierId: supplier.id,
        name: options.priceListName || `Price List - ${new Date().toISOString().split('T')[0]}`,
        description: options.description || `Uploaded via Enhanced Import - ${data.length} items`,
        effectiveDate: options.effectiveDate || new Date(),
        expiryDate: options.expiryDate || null,
        currency: options.currency || this.detectPrimaryCurrency(data),
        status: options.autoActivate ? 'active' : 'pending',
        uploadedBy: userId,
        uploadId,
        sourceFile: options.originalFileName,
        metadata: {
          uploadMethod: 'enhanced',
          itemCount: data.length,
          processingOptions: options
        }
      };

      const priceList = await createPriceList(priceListData);
      
      // Create items in batches
      const batchSize = options.batchSize || 100;
      let itemsCreated = 0;
      
      for (let i = 0; i < data.length; i += batchSize) {
        const batch = data.slice(i, i + batchSize);
        const itemsData = batch.map(item => ({
          ...item,
          priceListId: priceList.id,
          supplierId: supplier.id
        }));
        
        await createPriceListItems(itemsData);
        itemsCreated += batch.length;
        
        // Update progress
        const progress = Math.round((itemsCreated / data.length) * 100);
        await this.updateUploadStatus(uploadId, 'importing_items', `Imported ${itemsCreated}/${data.length} items`, { progress });
      }

      return {
        priceListId: priceList.id,
        itemsCreated,
        summary: {
          priceList,
          totalValue: data.reduce((sum, item) => sum + item.unitPrice, 0),
          categories: [...new Set(data.map(item => item.category).filter(Boolean))],
          currencies: [...new Set(data.map(item => item.currency))]
        }
      };
    } catch (error) {
      throw new Error(`Import execution failed: ${error.message}`);
    }
  }

  /**
   * Handle post-processing tasks
   */
  async handlePostProcessing(importResult, options, uploadId) {
    try {
      // Send notifications
      if (options.notifySupplier || options.notifyApprovers) {
        await this.notifications.sendUploadNotification({
          uploadId,
          priceListId: importResult.priceListId,
          itemsProcessed: importResult.itemsCreated,
          notifySupplier: options.notifySupplier,
          notifyApprovers: options.notifyApprovers
        });
      }

      // Create version record
      if (options.createNewVersion) {
        await this.versionControl.createVersion({
          priceListId: importResult.priceListId,
          uploadId,
          summary: importResult.summary
        });
      }

      // Integration hooks
      this.emit('import:completed', {
        uploadId,
        priceListId: importResult.priceListId,
        summary: importResult.summary
      });
    } catch (error) {
      console.error('Post-processing error:', error);
      // Don't fail the entire upload for post-processing errors
    }
  }

  /**
   * Update upload status
   */
  async updateUploadStatus(uploadId, status, message, metadata = {}) {
    try {
      await updateUploadHistoryStatus(uploadId, status, {
        message,
        ...metadata,
        timestamp: new Date()
      });

      this.emit('upload:status_updated', { uploadId, status, message, metadata });
    } catch (error) {
      console.error('Failed to update upload status:', error);
    }
  }

  /**
   * Fail upload with error details
   */
  async failUpload(uploadId, reason, errors) {
    await updateUploadHistoryStatus(uploadId, 'failed', {
      failureReason: reason,
      errors,
      failedAt: new Date()
    });

    this.emit('upload:failed', { uploadId, reason, errors });
  }

  /**
   * Detect file type from file object
   */
  detectFileType(file) {
    const extension = file.originalname?.toLowerCase().match(/\.[^.]+$/)?.[0];
    const mimeType = file.mimetype;

    if (extension?.includes('.csv') || mimeType?.includes('csv')) return 'CSV';
    if (extension?.includes('.xlsx') || extension?.includes('.xls')) return 'EXCEL';
    if (extension?.includes('.pdf')) return 'PDF';
    if (extension?.includes('.docx') || extension?.includes('.doc')) return 'WORD';
    if (extension?.includes('.json')) return 'JSON';
    if (extension?.includes('.xml')) return 'XML';
    if (extension?.includes('.eml') || extension?.includes('.msg')) return 'EMAIL';

    return 'UNKNOWN';
  }

  /**
   * Update service statistics
   */
  updateStats(type, data = {}) {
    this.stats.totalUploads++;
    
    if (type === 'success') {
      this.stats.successfulUploads++;
    } else {
      this.stats.failedUploads++;
    }

    if (data.processingTime) {
      this.stats.averageProcessingTime = 
        (this.stats.averageProcessingTime * (this.stats.totalUploads - 1) + data.processingTime) / this.stats.totalUploads;
    }

    if (data.format) {
      const formatKey = data.format.toLowerCase();
      if (this.stats.formatStats[formatKey] !== undefined) {
        this.stats.formatStats[formatKey]++;
      }
    }
  }

  /**
   * Get service statistics
   */
  getStats() {
    return {
      ...this.stats,
      successRate: this.stats.totalUploads > 0 
        ? (this.stats.successfulUploads / this.stats.totalUploads * 100).toFixed(2)
        : 0
    };
  }

  /**
   * Get upload data from temporary storage
   */
  async getUploadData(uploadId) {
    try {
      // In production, this would use Redis or database for temporary storage
      // For now, we'll use in-memory storage with a Map
      if (!this.uploadDataCache) {
        this.uploadDataCache = new Map();
      }
      
      const uploadData = this.uploadDataCache.get(uploadId);
      if (!uploadData) {
        return null;
      }
      
      // Check if data has expired (24 hours)
      const expiryTime = 24 * 60 * 60 * 1000; // 24 hours
      if (Date.now() - uploadData.timestamp > expiryTime) {
        this.uploadDataCache.delete(uploadId);
        return null;
      }
      
      return uploadData;
    } catch (error) {
      console.error('Failed to get upload data:', error);
      return null;
    }
  }

  /**
   * Store upload data temporarily
   */
  async storeUploadData(uploadId, data) {
    try {
      if (!this.uploadDataCache) {
        this.uploadDataCache = new Map();
      }
      
      this.uploadDataCache.set(uploadId, {
        ...data,
        timestamp: Date.now()
      });
      
      return true;
    } catch (error) {
      console.error('Failed to store upload data:', error);
      return false;
    }
  }

  /**
   * Clean up temporary upload data
   */
  async cleanupUploadData(uploadId) {
    try {
      if (this.uploadDataCache) {
        this.uploadDataCache.delete(uploadId);
      }
      return true;
    } catch (error) {
      console.error('Failed to cleanup upload data:', error);
      return false;
    }
  }

  /**
   * Merge duplicate items with conflict resolution
   */
  async mergeDuplicates(duplicates, newItems) {
    const merged = [...newItems];
    
    for (const duplicate of duplicates) {
      const { existing, new: newItem } = duplicate;
      
      // Create merged item by combining data
      const mergedItem = {
        ...existing,
        // Take newer price if different
        unitPrice: newItem.unitPrice !== existing.unitPrice ? newItem.unitPrice : existing.unitPrice,
        // Update description if provided
        description: newItem.description || existing.description,
        // Update stock level if provided
        stockLevel: newItem.stockLevel !== undefined ? newItem.stockLevel : existing.stockLevel,
        // Update lead time if provided
        leadTimeDays: newItem.leadTimeDays !== undefined ? newItem.leadTimeDays : existing.leadTimeDays,
        // Mark as merged
        isMerged: true,
        mergedFrom: {
          existingId: existing.id,
          newData: newItem,
          mergedAt: new Date().toISOString()
        }
      };
      
      merged.push(mergedItem);
    }
    
    return merged;
  }

  /**
   * Calculate price distribution for analytics
   */
  calculatePriceDistribution(data) {
    const prices = data.map(item => item.unitPrice).filter(price => price > 0);
    
    if (prices.length === 0) {
      return {
        min: 0,
        max: 0,
        average: 0,
        median: 0,
        distribution: {}
      };
    }
    
    prices.sort((a, b) => a - b);
    
    const min = prices[0];
    const max = prices[prices.length - 1];
    const average = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    const median = prices.length % 2 === 0 
      ? (prices[Math.floor(prices.length / 2) - 1] + prices[Math.floor(prices.length / 2)]) / 2
      : prices[Math.floor(prices.length / 2)];
    
    // Create price range distribution
    const ranges = [
      { label: 'Under $10', min: 0, max: 10 },
      { label: '$10-$50', min: 10, max: 50 },
      { label: '$50-$100', min: 50, max: 100 },
      { label: '$100-$500', min: 100, max: 500 },
      { label: '$500-$1000', min: 500, max: 1000 },
      { label: 'Over $1000', min: 1000, max: Infinity }
    ];
    
    const distribution = {};
    ranges.forEach(range => {
      const count = prices.filter(price => price >= range.min && price < range.max).length;
      distribution[range.label] = {
        count,
        percentage: ((count / prices.length) * 100).toFixed(1)
      };
    });
    
    return {
      min: min.toFixed(2),
      max: max.toFixed(2),
      average: average.toFixed(2),
      median: median.toFixed(2),
      distribution
    };
  }

  /**
   * Detect primary currency from data
   */
  detectPrimaryCurrency(data) {
    const currencyCount = {};
    
    data.forEach(item => {
      const currency = item.currency || 'USD';
      currencyCount[currency] = (currencyCount[currency] || 0) + 1;
    });
    
    // Return the most common currency
    let primaryCurrency = 'USD';
    let maxCount = 0;
    
    for (const [currency, count] of Object.entries(currencyCount)) {
      if (count > maxCount) {
        maxCount = count;
        primaryCurrency = currency;
      }
    }
    
    return primaryCurrency;
  }

  /**
   * Generate mapping suggestions for intelligent column mapping
   */
  async generateMappingSuggestions(data) {
    if (!Array.isArray(data) || data.length === 0) {
      return [];
    }
    
    const headers = Object.keys(data[0]);
    const standardFields = [
      'sku', 'product_name', 'description', 'unit_price', 'currency',
      'category', 'minimum_order_quantity', 'lead_time_days', 'stock_level'
    ];
    
    const suggestions = [];
    
    // Simple fuzzy matching for column mapping suggestions
    headers.forEach(header => {
      const normalizedHeader = header.toLowerCase().replace(/[^a-z0-9]/g, '_');
      
      let bestMatch = null;
      let bestScore = 0;
      
      standardFields.forEach(field => {
        const score = this.calculateStringSimilarity(normalizedHeader, field);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = field;
        }
      });
      
      if (bestScore > 0.6) { // 60% similarity threshold
        suggestions.push({
          sourceColumn: header,
          suggestedField: bestMatch,
          confidence: bestScore,
          automatic: bestScore > 0.8
        });
      }
    });
    
    return suggestions;
  }

  /**
   * Calculate string similarity for column mapping
   */
  calculateStringSimilarity(str1, str2) {
    const len1 = str1.length;
    const len2 = str2.length;
    
    if (len1 === 0) return len2 === 0 ? 1 : 0;
    if (len2 === 0) return 0;
    
    // Simple implementation of string similarity
    let matches = 0;
    const minLen = Math.min(len1, len2);
    
    for (let i = 0; i < minLen; i++) {
      if (str1[i] === str2[i]) {
        matches++;
      }
    }
    
    // Include partial matches for common substrings
    const commonSubstrings = this.findCommonSubstrings(str1, str2);
    const substringBonus = commonSubstrings.length * 0.1;
    
    return (matches / Math.max(len1, len2)) + substringBonus;
  }

  /**
   * Find common substrings between two strings
   */
  findCommonSubstrings(str1, str2) {
    const common = [];
    const words1 = str1.split('_');
    const words2 = str2.split('_');
    
    words1.forEach(word1 => {
      words2.forEach(word2 => {
        if (word1 === word2 && word1.length > 2) {
          common.push(word1);
        }
      });
    });
    
    return common;
  }

  /**
   * Get existing supplier items for duplicate detection
   */
  async getExistingSupplierItems(supplierId) {
    try {
      // This would query the database for existing items
      // For now, return empty array to avoid database dependency issues
      return [];
    } catch (error) {
      console.error('Failed to get existing supplier items:', error);
      return [];
    }
  }

  /**
   * Apply mapping overrides during approval
   */
  async applyMappingOverrides(data, mappingOverrides) {
    if (!mappingOverrides || Object.keys(mappingOverrides).length === 0) {
      return data;
    }
    
    return data.map(item => {
      const mappedItem = { ...item };
      
      // Apply field mappings
      for (const [targetField, sourceField] of Object.entries(mappingOverrides)) {
        if (item[sourceField] !== undefined) {
          mappedItem[targetField] = item[sourceField];
          // Remove the old field if it's different
          if (sourceField !== targetField) {
            delete mappedItem[sourceField];
          }
        }
      }
      
      return mappedItem;
    });
  }

  /**
   * Apply duplicate resolutions during approval
   */
  async applyDuplicateResolutions(data, duplicateResolutions) {
    if (!duplicateResolutions || Object.keys(duplicateResolutions).length === 0) {
      return data;
    }
    
    const resolvedData = [];
    
    data.forEach(item => {
      const resolution = duplicateResolutions[item.sku];
      
      if (resolution) {
        switch (resolution.action) {
          case 'skip':
            // Don't add this item
            break;
          case 'overwrite':
            resolvedData.push({ ...item, overwriteExisting: true });
            break;
          case 'merge':
            resolvedData.push({ ...item, mergeWithExisting: true });
            break;
          default:
            resolvedData.push(item);
        }
      } else {
        resolvedData.push(item);
      }
    });
    
    return resolvedData;
  }

  /**
   * Apply price rule overrides during approval
   */
  async applyPriceRuleOverrides(data, priceRuleOverrides) {
    if (!priceRuleOverrides || Object.keys(priceRuleOverrides).length === 0) {
      return data;
    }
    
    return data.map(item => {
      const override = priceRuleOverrides[item.sku];
      
      if (override) {
        return {
          ...item,
          unitPrice: override.unitPrice || item.unitPrice,
          currency: override.currency || item.currency,
          priceOverridden: true,
          originalPrice: item.unitPrice
        };
      }
      
      return item;
    });
  }
}

// Export singleton instance  
export const supplierUploadEnhanced = new SupplierUploadEnhancedService();
export default supplierUploadEnhanced;