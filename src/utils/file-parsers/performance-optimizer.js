// Performance optimization module for large file processing
// Implements streaming, chunking, and memory management for files with 1000+ items

import { createReadStream } from 'fs';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';

// Performance configuration
const PERFORMANCE_CONFIG = {
  // Chunk sizes for different operations
  parsing: {
    csvChunkSize: 1000,           // Records per chunk for CSV parsing
    excelChunkSize: 500,          // Records per chunk for Excel parsing
    jsonChunkSize: 2000,          // Records per chunk for JSON parsing
    xmlChunkSize: 800,            // Records per chunk for XML parsing
    pdfChunkSize: 200             // Records per chunk for PDF parsing
  },
  
  // Memory management
  memory: {
    maxMemoryUsage: 256 * 1024 * 1024,  // 256MB max memory usage
    gcThreshold: 128 * 1024 * 1024,     // Trigger GC at 128MB
    streamBufferSize: 64 * 1024         // 64KB stream buffer
  },
  
  // Processing limits
  processing: {
    maxItemsInMemory: 5000,       // Max items to keep in memory
    batchSize: 100,               // Database batch insert size
    concurrentValidations: 10,    // Concurrent validation operations
    timeoutPerChunk: 30000        // 30 seconds per chunk
  },
  
  // Optimization strategies
  strategies: {
    useStreaming: true,           // Use streaming for large files
    enableCompression: true,      // Enable compression for temporary files
    cacheValidationResults: true, // Cache validation patterns
    useWorkerThreads: false,      // Use worker threads (Node.js 10.5+)
    enableProgressReporting: true // Enable detailed progress reporting
  }
};

// Performance optimizer class
export class PerformanceOptimizer {
  constructor(options = {}) {
    this.config = { ...PERFORMANCE_CONFIG, ...options };
    this.metrics = {
      startTime: null,
      endTime: null,
      memoryUsage: [],
      processingTimes: [],
      chunkTimes: [],
      itemsProcessed: 0,
      totalItems: 0
    };
    
    // Validation cache for common patterns
    this.validationCache = new Map();
    this.maxCacheSize = 1000;
    
    // Memory monitoring
    this.memoryMonitor = null;
    this.isMonitoring = false;
  }

  // Optimize file parsing based on size and type
  async optimizeFileParsing(fileBuffer, fileType, originalParser, options = {}) {
    const fileSize = fileBuffer.length;
    const estimatedItems = this.estimateItemCount(fileBuffer, fileType);
    
    this.metrics.startTime = Date.now();
    this.metrics.totalItems = estimatedItems;
    
    // Start memory monitoring
    this.startMemoryMonitoring();
    
    try {
      // Choose optimization strategy based on file characteristics
      const strategy = this.chooseOptimizationStrategy(fileSize, estimatedItems, fileType);
      
      let result;
      switch (strategy) {
        case 'streaming':
          result = await this.streamingParse(fileBuffer, fileType, originalParser, options);
          break;
        case 'chunked':
          result = await this.chunkedParse(fileBuffer, fileType, originalParser, options);
          break;
        case 'batched':
          result = await this.batchedParse(fileBuffer, fileType, originalParser, options);
          break;
        case 'standard':
        default:
          result = await this.standardParse(fileBuffer, fileType, originalParser, options);
          break;
      }
      
      this.metrics.endTime = Date.now();
      
      // Add performance metrics to result
      result.performanceMetrics = this.getMetrics();
      
      return result;
    } finally {
      this.stopMemoryMonitoring();
      this.cleanup();
    }
  }

  // Estimate item count from file buffer
  estimateItemCount(fileBuffer, fileType) {
    const sampleSize = Math.min(fileBuffer.length, 50000); // Sample first 50KB
    const sample = fileBuffer.slice(0, sampleSize).toString('utf-8');
    
    switch (fileType.toLowerCase()) {
      case 'csv':
        const csvLines = sample.split('\\n').filter(line => line.trim());
        const ratio = fileBuffer.length / sampleSize;
        return Math.ceil((csvLines.length - 1) * ratio); // Subtract header
      
      case 'excel':
        // Rough estimate for Excel files
        return Math.ceil(fileBuffer.length / 100); // Assume ~100 bytes per item
      
      case 'json':
        const jsonBraces = (sample.match(/\\{/g) || []).length;
        const jsonRatio = fileBuffer.length / sampleSize;
        return Math.ceil(jsonBraces * jsonRatio);
      
      case 'xml':
        const xmlElements = (sample.match(/<item|<product|<article/gi) || []).length;
        const xmlRatio = fileBuffer.length / sampleSize;
        return Math.ceil(xmlElements * xmlRatio);
      
      default:
        return Math.ceil(fileBuffer.length / 80); // Conservative estimate
    }
  }

  // Choose optimization strategy based on file characteristics
  chooseOptimizationStrategy(fileSize, estimatedItems, fileType) {
    // Large files or many items: use streaming
    if (fileSize > 10 * 1024 * 1024 || estimatedItems > 5000) {
      if (this.config.strategies.useStreaming && ['csv', 'json'].includes(fileType.toLowerCase())) {
        return 'streaming';
      } else {
        return 'chunked';
      }
    }
    
    // Medium files: use chunked processing
    if (fileSize > 1 * 1024 * 1024 || estimatedItems > 1000) {
      return 'chunked';
    }
    
    // Small-medium files: use batched processing
    if (estimatedItems > 100) {
      return 'batched';
    }
    
    // Small files: use standard processing
    return 'standard';
  }

  // Streaming parser for very large files
  async streamingParse(fileBuffer, fileType, originalParser, options) {
    const results = [];
    const errors = [];
    let totalRows = 0;
    let chunkIndex = 0;
    
    // Create streaming parser based on file type
    const streamProcessor = this.createStreamProcessor(fileType, originalParser, options);
    
    return new Promise((resolve, reject) => {
      let tempBuffer = '';
      let lineBuffer = [];
      const chunkSize = this.config.parsing[fileType + 'ChunkSize'] || 1000;
      
      const processChunk = async (chunk) => {
        const chunkStartTime = Date.now();
        chunkIndex++;
        
        try {
          // Parse chunk
          const chunkResult = await originalParser(Buffer.from(chunk), {
            ...options,
            streaming: true,
            chunkIndex
          });
          
          if (chunkResult.success && chunkResult.data) {
            results.push(...chunkResult.data);
            this.metrics.itemsProcessed += chunkResult.data.length;
          }
          
          if (chunkResult.errors) {
            errors.push(...chunkResult.errors);
          }
          
          totalRows += chunkResult.totalRows || 0;
          
          // Track chunk processing time
          this.metrics.chunkTimes.push(Date.now() - chunkStartTime);
          
          // Trigger garbage collection if memory usage is high
          this.manageMemory();
          
          // Report progress
          if (options.onProgress) {
            options.onProgress({
              processed: this.metrics.itemsProcessed,
              total: this.metrics.totalItems,
              chunks: chunkIndex,
              memoryUsage: process.memoryUsage().heapUsed
            });
          }
          
        } catch (error) {
          errors.push({
            chunk: chunkIndex,
            error: error.message,
            timestamp: new Date()
          });
        }
      };
      
      // Process buffer in chunks for CSV/text files
      if (fileType.toLowerCase() === 'csv') {
        const lines = fileBuffer.toString('utf-8').split('\\n');
        const headers = lines[0];
        
        for (let i = 1; i < lines.length; i += chunkSize) {
          const chunkLines = [headers, ...lines.slice(i, i + chunkSize)];
          await processChunk(chunkLines.join('\\n'));
        }
      } else {
        // For other formats, use the original parser with chunking
        await processChunk(fileBuffer.toString('utf-8'));
      }
      
      resolve({
        success: errors.length === 0 || results.length > 0,
        data: results,
        errors,
        parsedCount: results.length,
        totalRows,
        strategy: 'streaming',
        chunks: chunkIndex
      });
    });
  }

  // Chunked parser for large files
  async chunkedParse(fileBuffer, fileType, originalParser, options) {
    const chunkSize = this.config.parsing[fileType + 'ChunkSize'] || 1000;
    const results = [];
    const errors = [];
    let totalRows = 0;
    
    // Convert buffer to string and split into logical chunks
    const content = fileBuffer.toString('utf-8');
    const chunks = this.createLogicalChunks(content, fileType, chunkSize);
    
    for (let i = 0; i < chunks.length; i++) {
      const chunkStartTime = Date.now();
      
      try {
        // Parse chunk
        const chunkBuffer = Buffer.from(chunks[i]);
        const chunkResult = await originalParser(chunkBuffer, {
          ...options,
          chunk: true,
          chunkIndex: i
        });
        
        if (chunkResult.success && chunkResult.data) {
          results.push(...chunkResult.data);
          this.metrics.itemsProcessed += chunkResult.data.length;
        }
        
        if (chunkResult.errors) {
          errors.push(...chunkResult.errors);
        }
        
        totalRows += chunkResult.totalRows || 0;
        
        // Track chunk processing time
        this.metrics.chunkTimes.push(Date.now() - chunkStartTime);
        
        // Memory management
        this.manageMemory();
        
        // Progress reporting
        if (options.onProgress) {
          options.onProgress({
            processed: i + 1,
            total: chunks.length,
            items: this.metrics.itemsProcessed,
            memoryUsage: process.memoryUsage().heapUsed
          });
        }
        
      } catch (error) {
        errors.push({
          chunk: i,
          error: error.message,
          timestamp: new Date()
        });
      }
    }
    
    return {
      success: errors.length === 0 || results.length > 0,
      data: results,
      errors,
      parsedCount: results.length,
      totalRows,
      strategy: 'chunked',
      chunks: chunks.length
    };
  }

  // Batched parser for medium files
  async batchedParse(fileBuffer, fileType, originalParser, options) {
    // Parse entire file first
    const fullResult = await originalParser(fileBuffer, options);
    
    if (!fullResult.success || !fullResult.data) {
      return fullResult;
    }
    
    // Process data in batches for validation and transformation
    const batchSize = this.config.processing.batchSize;
    const batches = [];
    
    for (let i = 0; i < fullResult.data.length; i += batchSize) {
      batches.push(fullResult.data.slice(i, i + batchSize));
    }
    
    // Process batches with optimized validation
    const processedData = [];
    const errors = [...(fullResult.errors || [])];
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const batchStartTime = Date.now();
      
      try {
        // Optimize validation for batch
        const validatedBatch = await this.optimizeValidation(batch, options);
        processedData.push(...validatedBatch);
        
        this.metrics.itemsProcessed += batch.length;
        this.metrics.processingTimes.push(Date.now() - batchStartTime);
        
        // Progress reporting
        if (options.onProgress) {
          options.onProgress({
            processed: i + 1,
            total: batches.length,
            items: this.metrics.itemsProcessed
          });
        }
        
      } catch (error) {
        errors.push({
          batch: i,
          error: error.message,
          items: batch.length
        });
      }
    }
    
    return {
      ...fullResult,
      data: processedData,
      errors,
      strategy: 'batched',
      batches: batches.length
    };
  }

  // Standard parser for small files
  async standardParse(fileBuffer, fileType, originalParser, options) {
    const result = await originalParser(fileBuffer, options);
    
    if (result.success && result.data) {
      this.metrics.itemsProcessed = result.data.length;
    }
    
    return {
      ...result,
      strategy: 'standard'
    };
  }

  // Create logical chunks based on file type
  createLogicalChunks(content, fileType, chunkSize) {
    switch (fileType.toLowerCase()) {
      case 'csv':
        return this.createCSVChunks(content, chunkSize);
      case 'json':
        return this.createJSONChunks(content, chunkSize);
      case 'xml':
        return this.createXMLChunks(content, chunkSize);
      default:
        // Generic chunking
        const chunkLength = Math.ceil(content.length / Math.ceil(content.length / (chunkSize * 100)));
        const chunks = [];
        for (let i = 0; i < content.length; i += chunkLength) {
          chunks.push(content.slice(i, i + chunkLength));
        }
        return chunks;
    }
  }

  // Create CSV chunks preserving row boundaries
  createCSVChunks(content, chunkSize) {
    const lines = content.split('\\n');
    const headers = lines[0];
    const chunks = [];
    
    for (let i = 1; i < lines.length; i += chunkSize) {
      const chunkLines = [headers, ...lines.slice(i, i + chunkSize)];
      chunks.push(chunkLines.join('\\n'));
    }
    
    return chunks;
  }

  // Create JSON chunks preserving object boundaries
  createJSONChunks(content, chunkSize) {
    try {
      const data = JSON.parse(content);
      const chunks = [];
      
      if (Array.isArray(data)) {
        for (let i = 0; i < data.length; i += chunkSize) {
          chunks.push(JSON.stringify(data.slice(i, i + chunkSize)));
        }
      } else if (data.items && Array.isArray(data.items)) {
        for (let i = 0; i < data.items.length; i += chunkSize) {
          const chunk = {
            ...data,
            items: data.items.slice(i, i + chunkSize)
          };
          chunks.push(JSON.stringify(chunk));
        }
      } else {
        chunks.push(content); // Single object
      }
      
      return chunks;
    } catch (error) {
      // Fallback to simple chunking
      const chunkLength = Math.ceil(content.length / Math.ceil(content.length / (chunkSize * 100)));
      const chunks = [];
      for (let i = 0; i < content.length; i += chunkLength) {
        chunks.push(content.slice(i, i + chunkLength));
      }
      return chunks;
    }
  }

  // Create XML chunks preserving element boundaries
  createXMLChunks(content, chunkSize) {
    // Simple XML chunking - could be enhanced with proper XML parsing
    const itemPattern = /<(item|product|article)[^>]*>.*?<\\/\\1>/gis;
    const items = content.match(itemPattern) || [];
    const chunks = [];
    
    // Get XML header and root element
    const xmlHeader = content.match(/<\\?xml[^>]*\\?>/)?.[0] || '';
    const rootStart = content.match(/<[^?][^>]*>/)?.[0] || '<root>';
    const rootEnd = '</' + rootStart.replace(/^<([^\\s>]+).*/, '$1') + '>';
    
    for (let i = 0; i < items.length; i += chunkSize) {
      const chunkItems = items.slice(i, i + chunkSize);
      const chunkContent = xmlHeader + rootStart + chunkItems.join('') + rootEnd;
      chunks.push(chunkContent);
    }
    
    return chunks.length > 0 ? chunks : [content];
  }

  // Optimize validation using caching and batch processing
  async optimizeValidation(items, options) {
    const validatedItems = [];
    const cacheHits = 0;
    
    for (const item of items) {
      // Create cache key for item validation
      const cacheKey = this.createValidationCacheKey(item);
      
      if (this.validationCache.has(cacheKey)) {
        // Use cached validation result
        const cachedResult = this.validationCache.get(cacheKey);
        validatedItems.push({ ...item, ...cachedResult });
        continue;
      }
      
      // Validate item (simplified validation for performance)
      const validationResult = this.fastValidateItem(item);
      
      // Cache validation result
      if (this.validationCache.size < this.maxCacheSize) {
        this.validationCache.set(cacheKey, validationResult);
      }
      
      validatedItems.push({ ...item, ...validationResult });
    }
    
    return validatedItems;
  }

  // Create cache key for validation
  createValidationCacheKey(item) {
    return JSON.stringify({
      sku: item.sku,
      unitPrice: item.unitPrice,
      currency: item.currency,
      hasDescription: !!item.description,
      hasTierPricing: !!(item.tierPricing && item.tierPricing.length > 0)
    });
  }

  // Fast item validation (basic checks only)
  fastValidateItem(item) {
    const result = {
      isValid: true,
      errors: [],
      warnings: []
    };
    
    // Basic required field checks
    if (!item.sku) {
      result.isValid = false;
      result.errors.push('SKU is required');
    }
    
    if (!item.unitPrice || item.unitPrice <= 0) {
      result.isValid = false;
      result.errors.push('Valid unit price is required');
    }
    
    // Basic format checks
    if (item.sku && item.sku.length > 50) {
      result.warnings.push('SKU is very long');
    }
    
    if (item.unitPrice && item.unitPrice > 100000) {
      result.warnings.push('Unit price is very high');
    }
    
    return result;
  }

  // Memory management
  manageMemory() {
    const memUsage = process.memoryUsage();
    this.metrics.memoryUsage.push({
      timestamp: Date.now(),
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external
    });
    
    // Trigger garbage collection if memory usage is high
    if (memUsage.heapUsed > this.config.memory.gcThreshold) {
      if (global.gc) {
        global.gc();
      }
    }
    
    // Clear validation cache if memory is constrained
    if (memUsage.heapUsed > this.config.memory.maxMemoryUsage * 0.8) {
      this.validationCache.clear();
    }
  }

  // Start memory monitoring
  startMemoryMonitoring() {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    this.memoryMonitor = setInterval(() => {
      this.manageMemory();
    }, 5000); // Check every 5 seconds
  }

  // Stop memory monitoring
  stopMemoryMonitoring() {
    if (this.memoryMonitor) {
      clearInterval(this.memoryMonitor);
      this.memoryMonitor = null;
    }
    this.isMonitoring = false;
  }

  // Get performance metrics
  getMetrics() {
    const totalTime = this.metrics.endTime - this.metrics.startTime;
    const avgChunkTime = this.metrics.chunkTimes.length > 0 
      ? this.metrics.chunkTimes.reduce((a, b) => a + b, 0) / this.metrics.chunkTimes.length 
      : 0;
    
    const peakMemory = this.metrics.memoryUsage.length > 0 
      ? Math.max(...this.metrics.memoryUsage.map(m => m.heapUsed))
      : 0;
    
    return {
      totalProcessingTime: totalTime,
      itemsPerSecond: totalTime > 0 ? (this.metrics.itemsProcessed / (totalTime / 1000)).toFixed(2) : 0,
      averageChunkTime: avgChunkTime,
      peakMemoryUsage: peakMemory,
      memoryEfficiency: this.metrics.itemsProcessed > 0 ? (peakMemory / this.metrics.itemsProcessed).toFixed(0) : 0,
      totalChunks: this.metrics.chunkTimes.length,
      cacheHitRate: this.validationCache.size > 0 ? ((this.validationCache.size / this.metrics.itemsProcessed) * 100).toFixed(1) : 0
    };
  }

  // Cleanup resources
  cleanup() {
    this.stopMemoryMonitoring();
    this.validationCache.clear();
    this.metrics = {
      startTime: null,
      endTime: null,
      memoryUsage: [],
      processingTimes: [],
      chunkTimes: [],
      itemsProcessed: 0,
      totalItems: 0
    };
  }

  // Create stream processor (placeholder for streaming implementation)
  createStreamProcessor(fileType, originalParser, options) {
    return new Transform({
      objectMode: true,
      transform(chunk, encoding, callback) {
        // Process chunk
        callback(null, chunk);
      }
    });
  }
}

// Export singleton instance
export const performanceOptimizer = new PerformanceOptimizer();

// Helper function to wrap parsers with performance optimization
export function withPerformanceOptimization(parser, fileType) {
  return async (fileBuffer, options = {}) => {
    // Only optimize for large files
    const shouldOptimize = fileBuffer.length > 1024 * 1024 || // > 1MB
      performanceOptimizer.estimateItemCount(fileBuffer, fileType) > 1000;
    
    if (shouldOptimize && options.optimize !== false) {
      return await performanceOptimizer.optimizeFileParsing(
        fileBuffer, 
        fileType, 
        parser, 
        options
      );
    } else {
      // Use original parser for small files
      return await parser(fileBuffer, options);
    }
  };
}

// Export performance configuration for external use
export { PERFORMANCE_CONFIG };