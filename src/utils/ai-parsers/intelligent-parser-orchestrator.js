// AI Parser Orchestrator
// Intelligent file type detection and parser selection with learning capabilities

import { IntelligentPDFParser } from './intelligent-pdf-parser.js';
import { IntelligentWordParser } from './intelligent-word-parser.js';
import { IntelligentEmailParser } from './intelligent-email-parser.js';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

// File type detection patterns
const FILE_PATTERNS = {
  pdf: {
    magic: '%PDF',
    extensions: ['.pdf']
  },
  word: {
    magic: ['PK', 'ÐÏ\x11à'], // DOCX (ZIP) and DOC
    extensions: ['.docx', '.doc']
  },
  email: {
    magic: ['From:', 'MIME-Version:', 'Message-ID:'],
    extensions: ['.eml', '.msg']
  },
  excel: {
    magic: ['PK', 'ÐÏ\x11à'],
    extensions: ['.xlsx', '.xls']
  },
  csv: {
    magic: null, // No specific magic bytes
    extensions: ['.csv', '.tsv']
  }
};

// AI Learning System for parser improvements
class ParserLearningSystem {
  constructor(storagePath = './.ai-parser-learning') {
    this.storagePath = storagePath;
    this.learningData = {
      successfulParsings: [],
      failedParsings: [],
      columnMappings: new Map(),
      fileTypePatterns: new Map(),
      parsingStrategies: new Map()
    };
  }

  // Load learning data
  async load() {
    try {
      const dataPath = path.join(this.storagePath, 'learning-data.json');
      const data = await fs.readFile(dataPath, 'utf-8');
      const parsed = JSON.parse(data);
      
      this.learningData = {
        successfulParsings: parsed.successfulParsings || [],
        failedParsings: parsed.failedParsings || [],
        columnMappings: new Map(parsed.columnMappings || []),
        fileTypePatterns: new Map(parsed.fileTypePatterns || []),
        parsingStrategies: new Map(parsed.parsingStrategies || [])
      };
    } catch (error) {
      // No existing data, that's okay
    }
  }

  // Save learning data
  async save() {
    try {
      await fs.mkdir(this.storagePath, { recursive: true });
      const dataPath = path.join(this.storagePath, 'learning-data.json');
      
      const data = {
        successfulParsings: this.learningData.successfulParsings.slice(-1000), // Keep last 1000
        failedParsings: this.learningData.failedParsings.slice(-500), // Keep last 500
        columnMappings: Array.from(this.learningData.columnMappings.entries()),
        fileTypePatterns: Array.from(this.learningData.fileTypePatterns.entries()),
        parsingStrategies: Array.from(this.learningData.parsingStrategies.entries())
      };
      
      await fs.writeFile(dataPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Failed to save learning data:', error);
    }
  }

  // Record successful parsing
  recordSuccess(fileInfo, result) {
    const record = {
      timestamp: new Date().toISOString(),
      fileType: fileInfo.type,
      fileSize: fileInfo.size,
      itemsExtracted: result.parsedCount,
      confidence: result.confidence || 1,
      extractionMethod: result.extractionMethod,
      hash: this.hashResult(result)
    };
    
    this.learningData.successfulParsings.push(record);
    
    // Learn from column mappings if available
    if (result.columnMappings) {
      Object.entries(result.columnMappings).forEach(([column, mapping]) => {
        this.learningData.columnMappings.set(column.toLowerCase(), mapping);
      });
    }
  }

  // Record failed parsing
  recordFailure(fileInfo, error) {
    const record = {
      timestamp: new Date().toISOString(),
      fileType: fileInfo.type,
      fileSize: fileInfo.size,
      error: error.message,
      errorType: error.type || 'unknown'
    };
    
    this.learningData.failedParsings.push(record);
  }

  // Get recommended strategy based on learning
  getRecommendedStrategy(fileInfo) {
    const fileTypeSuccess = this.learningData.successfulParsings
      .filter(r => r.fileType === fileInfo.type);
    
    if (fileTypeSuccess.length === 0) {
      return null;
    }

    // Analyze successful strategies
    const strategies = {};
    fileTypeSuccess.forEach(record => {
      const key = record.extractionMethod || 'default';
      strategies[key] = (strategies[key] || 0) + 1;
    });

    // Return most successful strategy
    return Object.entries(strategies)
      .sort((a, b) => b[1] - a[1])[0][0];
  }

  // Hash result for comparison
  hashResult(result) {
    const data = JSON.stringify({
      itemCount: result.parsedCount,
      firstItem: result.data?.[0]
    });
    return crypto.createHash('md5').update(data).digest('hex');
  }
}

// Main Intelligent Parser Orchestrator
export class IntelligentParserOrchestrator {
  constructor(options = {}) {
    this.options = {
      enableLearning: true,
      autoDetectFileType: true,
      maxFileSize: 50 * 1024 * 1024, // 50MB
      concurrentParsing: true,
      ...options
    };

    // Initialize parsers
    this.parsers = {
      pdf: new IntelligentPDFParser(options),
      word: new IntelligentWordParser(options),
      email: new IntelligentEmailParser(options)
    };

    // Initialize learning system
    this.learningSystem = new ParserLearningSystem(options.learningPath);
  }

  // Initialize orchestrator
  async initialize() {
    if (this.options.enableLearning) {
      await this.learningSystem.load();
    }
  }

  // Parse file with intelligent detection and routing
  async parseFile(fileBuffer, filename = '', options = {}) {
    const startTime = Date.now();
    
    try {
      // Initialize if not already done
      if (this.options.enableLearning && !this.initialized) {
        await this.initialize();
        this.initialized = true;
      }

      // Detect file type
      const fileInfo = await this.detectFileType(fileBuffer, filename);
      
      if (!fileInfo.type) {
        throw new Error(`Unable to determine file type for: ${filename}`);
      }

      // Check file size
      if (fileBuffer.length > this.options.maxFileSize) {
        throw new Error(`File too large: ${(fileBuffer.length / 1024 / 1024).toFixed(2)}MB exceeds limit`);
      }

      // Get recommended strategy from learning system
      const recommendedStrategy = this.learningSystem.getRecommendedStrategy(fileInfo);
      
      // Merge options with recommendations
      const parsingOptions = {
        ...options,
        ...recommendedStrategy ? { extractionMethod: recommendedStrategy } : {}
      };

      // Route to appropriate parser
      let result;
      switch (fileInfo.type) {
        case 'pdf':
          result = await this.parsers.pdf.parse(fileBuffer, parsingOptions);
          break;
          
        case 'word':
          result = await this.parsers.word.parse(fileBuffer, fileInfo.extension, parsingOptions);
          break;
          
        case 'email':
          result = await this.parsers.email.parse(fileBuffer, fileInfo.extension, parsingOptions);
          break;
          
        case 'excel':
          // Excel parser would be called here
          throw new Error('Excel parsing not implemented in this example');
          
        case 'csv':
          // CSV parser would be called here
          throw new Error('CSV parsing not implemented in this example');
          
        default:
          throw new Error(`Unsupported file type: ${fileInfo.type}`);
      }

      // Add metadata
      result.metadata = {
        ...result.metadata,
        filename: filename,
        fileType: fileInfo.type,
        fileSize: fileBuffer.length,
        parsedIn: Date.now() - startTime,
        parser: 'intelligent-ai-parser',
        version: '1.0.0'
      };

      // Record result for learning
      if (this.options.enableLearning) {
        if (result.success) {
          this.learningSystem.recordSuccess(fileInfo, result);
        } else {
          this.learningSystem.recordFailure(fileInfo, result);
        }
        await this.learningSystem.save();
      }

      return result;

    } catch (error) {
      const errorResult = {
        success: false,
        error: error.message,
        errors: [{ error: error.message, type: 'orchestration_error' }],
        parsedCount: 0,
        metadata: {
          filename: filename,
          parsedIn: Date.now() - startTime,
          parser: 'intelligent-ai-parser',
          version: '1.0.0'
        }
      };

      // Record failure for learning
      if (this.options.enableLearning) {
        this.learningSystem.recordFailure({ type: 'unknown', size: fileBuffer.length }, error);
        await this.learningSystem.save();
      }

      return errorResult;
    }
  }

  // Detect file type from buffer and filename
  async detectFileType(fileBuffer, filename) {
    const extension = path.extname(filename).toLowerCase();
    const header = fileBuffer.slice(0, 1024).toString('utf-8', 0, 1024);
    const binaryHeader = fileBuffer.slice(0, 8);

    // Check by extension first
    for (const [type, config] of Object.entries(FILE_PATTERNS)) {
      if (config.extensions.includes(extension)) {
        return { type, extension };
      }
    }

    // Check by magic bytes/content
    if (header.startsWith(FILE_PATTERNS.pdf.magic)) {
      return { type: 'pdf', extension: '.pdf' };
    }

    // Check for email patterns
    const emailPatterns = FILE_PATTERNS.email.magic;
    if (emailPatterns.some(pattern => header.includes(pattern))) {
      return { type: 'email', extension: extension || '.eml' };
    }

    // Check for Office documents (ZIP-based or OLE)
    if (binaryHeader[0] === 0x50 && binaryHeader[1] === 0x4B) {
      // ZIP-based format (DOCX, XLSX)
      if (extension === '.docx') return { type: 'word', extension: '.docx' };
      if (extension === '.xlsx') return { type: 'excel', extension: '.xlsx' };
      
      // Try to detect from ZIP contents
      return await this.detectZipBasedFormat(fileBuffer);
    }

    // OLE format (DOC, XLS)
    if (binaryHeader[0] === 0xD0 && binaryHeader[1] === 0xCF) {
      if (extension === '.doc') return { type: 'word', extension: '.doc' };
      if (extension === '.xls') return { type: 'excel', extension: '.xls' };
    }

    // Check for CSV patterns
    if (this.looksLikeCSV(header)) {
      return { type: 'csv', extension: '.csv' };
    }

    return { type: null, extension };
  }

  // Detect ZIP-based Office format
  async detectZipBasedFormat(fileBuffer) {
    try {
      // Would need to unzip and check content types
      // For now, return unknown
      return { type: null, extension: null };
    } catch (error) {
      return { type: null, extension: null };
    }
  }

  // Check if content looks like CSV
  looksLikeCSV(content) {
    const lines = content.split('\n').slice(0, 5);
    if (lines.length < 2) return false;

    // Check for consistent column count
    const columnCounts = lines.map(line => {
      const commas = (line.match(/,/g) || []).length;
      const tabs = (line.match(/\t/g) || []).length;
      return Math.max(commas, tabs);
    });

    // If all lines have similar column count, likely CSV
    const avgColumns = columnCounts.reduce((a, b) => a + b, 0) / columnCounts.length;
    const consistent = columnCounts.every(count => Math.abs(count - avgColumns) <= 1);

    return consistent && avgColumns >= 2;
  }

  // Parse multiple files concurrently
  async parseMultiple(files, options = {}) {
    if (!this.options.concurrentParsing) {
      // Sequential parsing
      const results = [];
      for (const file of files) {
        const result = await this.parseFile(file.buffer, file.filename, options);
        results.push(result);
      }
      return results;
    }

    // Concurrent parsing
    const promises = files.map(file => 
      this.parseFile(file.buffer, file.filename, options)
    );

    return await Promise.all(promises);
  }

  // Get parsing statistics from learning system
  getStatistics() {
    if (!this.options.enableLearning) {
      return null;
    }

    const stats = {
      totalParsings: this.learningSystem.learningData.successfulParsings.length +
                     this.learningSystem.learningData.failedParsings.length,
      successfulParsings: this.learningSystem.learningData.successfulParsings.length,
      failedParsings: this.learningSystem.learningData.failedParsings.length,
      successRate: 0,
      learnedMappings: this.learningSystem.learningData.columnMappings.size,
      fileTypeBreakdown: {}
    };

    if (stats.totalParsings > 0) {
      stats.successRate = (stats.successfulParsings / stats.totalParsings) * 100;
    }

    // Calculate file type breakdown
    this.learningSystem.learningData.successfulParsings.forEach(record => {
      stats.fileTypeBreakdown[record.fileType] = 
        (stats.fileTypeBreakdown[record.fileType] || 0) + 1;
    });

    return stats;
  }

  // Clean up resources
  async cleanup() {
    // Clean up parser resources
    if (this.parsers.pdf.cleanup) {
      await this.parsers.pdf.cleanup();
    }
    
    // Save final learning data
    if (this.options.enableLearning) {
      await this.learningSystem.save();
    }
  }
}

// Factory function for easy usage
export async function parseIntelligentDocument(fileBuffer, filename, options = {}) {
  const orchestrator = new IntelligentParserOrchestrator(options);
  try {
    await orchestrator.initialize();
    const result = await orchestrator.parseFile(fileBuffer, filename, options);
    return result;
  } finally {
    await orchestrator.cleanup();
  }
}

// Export all parsers for direct usage
export { IntelligentPDFParser, IntelligentWordParser, IntelligentEmailParser };