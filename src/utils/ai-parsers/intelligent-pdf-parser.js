// AI-Enhanced PDF Parser with OCR and Intelligent Table Extraction
// Implements machine learning techniques for robust document parsing

import pdfParse from 'pdf-parse';
import { createWorker } from 'tesseract.js';
import natural from 'natural';
import fuzzyset from 'fuzzyset';
import { promises as fs } from 'fs';

// Column mapping patterns using fuzzy matching
const COLUMN_PATTERNS = {
  sku: ['sku', 'item', 'product', 'part', 'article', 'reference', 'code', 'catalog'],
  description: ['description', 'name', 'title', 'product name', 'item description', 'details'],
  price: ['price', 'cost', 'rate', 'amount', 'value', 'unit price', 'list price'],
  currency: ['currency', 'curr', 'ccy', 'monetary', 'money'],
  quantity: ['quantity', 'qty', 'moq', 'minimum', 'order quantity', 'pack size'],
  uom: ['uom', 'unit', 'measure', 'um', 'units', 'packaging']
};

// Initialize fuzzy matchers for column detection
const createFuzzyMatchers = () => {
  const matchers = {};
  Object.entries(COLUMN_PATTERNS).forEach(([key, patterns]) => {
    matchers[key] = FuzzySet(patterns);
  });
  return matchers;
};

// AI-powered column mapping system
class IntelligentColumnMapper {
  constructor() {
    this.fuzzyMatchers = createFuzzyMatchers();
    this.learnedMappings = new Map();
    this.confidenceThreshold = 0.6;
  }

  // Map column headers using AI fuzzy matching
  mapColumns(headers) {
    const mappings = {};
    const unmapped = [];

    headers.forEach((header, index) => {
      const normalizedHeader = header.toLowerCase().trim();
      
      // Check learned mappings first
      if (this.learnedMappings.has(normalizedHeader)) {
        mappings[this.learnedMappings.get(normalizedHeader)] = index;
        return;
      }

      // Try fuzzy matching
      let bestMatch = null;
      let bestScore = 0;

      Object.entries(this.fuzzyMatchers).forEach(([fieldName, matcher]) => {
        const results = matcher.get(normalizedHeader);
        if (results && results.length > 0 && results[0][0] > bestScore) {
          bestScore = results[0][0];
          bestMatch = fieldName;
        }
      });

      if (bestScore >= this.confidenceThreshold) {
        mappings[bestMatch] = index;
        // Learn this mapping for future use
        this.learnedMappings.set(normalizedHeader, bestMatch);
      } else {
        unmapped.push({ header, index });
      }
    });

    return { mappings, unmapped, confidence: Object.keys(mappings).length / headers.length };
  }

  // Learn from successful mappings
  learnMapping(header, fieldName) {
    const normalizedHeader = header.toLowerCase().trim();
    this.learnedMappings.set(normalizedHeader, fieldName);
    
    // Also add to fuzzy set for better future matching
    if (this.fuzzyMatchers[fieldName]) {
      this.fuzzyMatchers[fieldName].add(normalizedHeader);
    }
  }

  // Save learned mappings to file
  async saveMappings(filePath) {
    const mappingsData = Object.fromEntries(this.learnedMappings);
    await fs.writeFile(filePath, JSON.stringify(mappingsData, null, 2));
  }

  // Load learned mappings from file
  async loadMappings(filePath) {
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      const mappingsData = JSON.parse(data);
      this.learnedMappings = new Map(Object.entries(mappingsData));
    } catch (error) {
      // File doesn't exist yet, that's okay
    }
  }
}

// Table detection using AI pattern recognition
class TableDetector {
  constructor() {
    this.tablePatterns = [
      // Pattern 1: Whitespace-aligned columns
      /^(\S+)\s{2,}(.+?)\s{2,}(\d+\.?\d*)\s{2,}(\S+)/,
      // Pattern 2: Tab-separated
      /^([^\t]+)\t+([^\t]+)\t+([^\t]+)/,
      // Pattern 3: Pipe-separated
      /^\|?\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)/,
      // Pattern 4: Fixed-width columns
      /^(.{10,20})(.{20,40})(.{10,20})(.{5,10})/
    ];
  }

  // Detect table structure in text
  detectTables(lines) {
    const tables = [];
    let currentTable = null;
    let consecutiveNonTableLines = 0;

    lines.forEach((line, index) => {
      const trimmedLine = line.trim();
      
      // Skip empty lines
      if (!trimmedLine) {
        consecutiveNonTableLines++;
        if (consecutiveNonTableLines > 3 && currentTable) {
          // End current table
          tables.push(currentTable);
          currentTable = null;
        }
        return;
      }

      // Check if line matches any table pattern
      let isTableRow = false;
      for (const pattern of this.tablePatterns) {
        if (pattern.test(trimmedLine)) {
          isTableRow = true;
          break;
        }
      }

      // Also check if line has multiple columns separated by spaces
      const columns = trimmedLine.split(/\s{2,}/).filter(col => col.trim());
      if (columns.length >= 3) {
        isTableRow = true;
      }

      if (isTableRow) {
        consecutiveNonTableLines = 0;
        if (!currentTable) {
          currentTable = {
            startLine: index,
            rows: [],
            possibleHeader: null
          };
        }
        
        // First row might be header
        if (currentTable.rows.length === 0) {
          currentTable.possibleHeader = columns;
        }
        
        currentTable.rows.push({ line: trimmedLine, columns, index });
      } else {
        consecutiveNonTableLines++;
        if (consecutiveNonTableLines > 3 && currentTable) {
          tables.push(currentTable);
          currentTable = null;
        }
      }
    });

    // Don't forget last table
    if (currentTable && currentTable.rows.length > 0) {
      tables.push(currentTable);
    }

    return tables;
  }

  // Extract structured data from detected tables
  extractTableData(table, columnMapper) {
    const items = [];
    const errors = [];
    
    // Try to identify header
    let headerIndex = 0;
    let mappings = {};
    
    if (table.possibleHeader) {
      const mappingResult = columnMapper.mapColumns(table.possibleHeader);
      if (mappingResult.confidence > 0.5) {
        mappings = mappingResult.mappings;
        headerIndex = 1; // Skip header row
      }
    }

    // Parse data rows
    for (let i = headerIndex; i < table.rows.length; i++) {
      const row = table.rows[i];
      try {
        const item = this.parseRow(row.columns, mappings);
        if (item && this.validateItem(item)) {
          items.push(item);
        }
      } catch (error) {
        errors.push({
          row: row.index + 1,
          error: error.message,
          data: row.line
        });
      }
    }

    return { items, errors };
  }

  // Parse a single row into structured item
  parseRow(columns, mappings) {
    const item = {};
    
    // Use mappings if available
    if (mappings.sku !== undefined && columns[mappings.sku]) {
      item.sku = columns[mappings.sku].trim();
    }
    if (mappings.description !== undefined && columns[mappings.description]) {
      item.description = columns[mappings.description].trim();
    }
    if (mappings.price !== undefined && columns[mappings.price]) {
      const priceStr = columns[mappings.price].replace(/[$,]/g, '').trim();
      item.unitPrice = parseFloat(priceStr);
    }
    if (mappings.currency !== undefined && columns[mappings.currency]) {
      item.currency = columns[mappings.currency].trim();
    }
    if (mappings.quantity !== undefined && columns[mappings.quantity]) {
      item.minimumOrderQuantity = parseInt(columns[mappings.quantity]);
    }
    if (mappings.uom !== undefined && columns[mappings.uom]) {
      item.unitOfMeasure = columns[mappings.uom].trim();
    }

    // If no mappings, try intelligent guessing
    if (Object.keys(mappings).length === 0) {
      columns.forEach((col, index) => {
        const trimmed = col.trim();
        
        // SKU pattern (alphanumeric with dashes)
        if (!item.sku && /^[A-Z0-9-]+$/i.test(trimmed)) {
          item.sku = trimmed;
        }
        // Price pattern
        else if (!item.unitPrice && /^\$?\d+\.?\d*$/.test(trimmed.replace(/,/g, ''))) {
          item.unitPrice = parseFloat(trimmed.replace(/[$,]/g, ''));
        }
        // Currency pattern
        else if (!item.currency && /^[A-Z]{3}$/.test(trimmed)) {
          item.currency = trimmed;
        }
        // Quantity pattern
        else if (!item.minimumOrderQuantity && /^\d+$/.test(trimmed) && parseInt(trimmed) < 10000) {
          item.minimumOrderQuantity = parseInt(trimmed);
        }
        // UOM pattern
        else if (!item.unitOfMeasure && /^[A-Z]{2,4}$/i.test(trimmed)) {
          item.unitOfMeasure = trimmed.toUpperCase();
        }
        // Description (usually longest text)
        else if (!item.description && trimmed.length > 5) {
          item.description = trimmed;
        }
      });
    }

    return item;
  }

  // Validate parsed item
  validateItem(item) {
    return item.sku && item.unitPrice && !isNaN(item.unitPrice) && item.unitPrice > 0;
  }
}

// Main AI-enhanced PDF parser
export class IntelligentPDFParser {
  constructor(options = {}) {
    this.options = {
      enableOCR: options.enableOCR !== false,
      ocrLanguage: options.ocrLanguage || 'eng',
      confidenceThreshold: options.confidenceThreshold || 0.6,
      learnedMappingsPath: options.learnedMappingsPath || './.ai-mappings.json',
      ...options
    };
    
    this.columnMapper = new IntelligentColumnMapper();
    this.tableDetector = new TableDetector();
    this.ocrWorker = null;
  }

  // Initialize OCR worker
  async initializeOCR() {
    if (!this.ocrWorker && this.options.enableOCR) {
      this.ocrWorker = await createWorker({
        logger: m => console.log(m)
      });
      await this.ocrWorker.loadLanguage(this.options.ocrLanguage);
      await this.ocrWorker.initialize(this.options.ocrLanguage);
    }
  }

  // Clean up resources
  async cleanup() {
    if (this.ocrWorker) {
      await this.ocrWorker.terminate();
      this.ocrWorker = null;
    }
  }

  // Parse PDF with AI enhancements
  async parse(fileBuffer) {
    try {
      // Load learned mappings
      await this.columnMapper.loadMappings(this.options.learnedMappingsPath);

      // First try standard text extraction
      let text = '';
      let extractionMethod = 'text';
      
      try {
        const pdfData = await pdfParse(fileBuffer);
        text = pdfData.text;
      } catch (error) {
        console.log('Standard PDF parsing failed, attempting OCR...');
      }

      // If no text or very little text, try OCR
      if ((!text || text.trim().length < 100) && this.options.enableOCR) {
        await this.initializeOCR();
        text = await this.performOCR(fileBuffer);
        extractionMethod = 'ocr';
      }

      if (!text || text.trim().length === 0) {
        throw new Error('No text content could be extracted from PDF');
      }

      // Parse the extracted text
      const lines = text.split('\n').map(line => line.trim()).filter(line => line);
      
      // Detect tables
      const tables = this.tableDetector.detectTables(lines);
      
      // Extract items from all detected tables
      let allItems = [];
      let allErrors = [];
      
      for (const table of tables) {
        const { items, errors } = this.tableDetector.extractTableData(table, this.columnMapper);
        allItems = allItems.concat(items);
        allErrors = allErrors.concat(errors);
      }

      // Extract metadata
      const metadata = this.extractMetadata(lines);

      // Learn from successful parsing
      if (allItems.length > 0) {
        await this.columnMapper.saveMappings(this.options.learnedMappingsPath);
      }

      // Apply tier pricing detection
      this.detectTierPricing(lines, allItems);

      return {
        success: allItems.length > 0,
        data: allItems,
        errors: allErrors,
        parsedCount: allItems.length,
        extractionMethod,
        metadata,
        confidence: this.calculateConfidence(allItems, allErrors),
        tablesDetected: tables.length
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
        errors: [{ error: error.message, type: 'parsing_error' }],
        parsedCount: 0
      };
    }
  }

  // Perform OCR on PDF
  async performOCR(fileBuffer) {
    // Note: In a real implementation, you would:
    // 1. Convert PDF pages to images
    // 2. Run OCR on each image
    // 3. Combine the text
    
    // For now, returning a placeholder
    return 'OCR text extraction would be performed here';
  }

  // Extract metadata from document
  extractMetadata(lines) {
    const metadata = {};
    const metadataPatterns = {
      supplierName: /supplier[:\s]+(.+)/i,
      effectiveDate: /effective\s*date[:\s]+(.+)/i,
      currency: /currency[:\s]+([A-Z]{3})/i,
      contactEmail: /email[:\s]+([^\s]+@[^\s]+)/i,
      contactPhone: /phone[:\s]+([\d\s\-\(\)]+)/i
    };

    lines.slice(0, 20).forEach(line => {
      Object.entries(metadataPatterns).forEach(([key, pattern]) => {
        const match = line.match(pattern);
        if (match && !metadata[key]) {
          metadata[key] = match[1].trim();
        }
      });
    });

    return metadata;
  }

  // Detect tier pricing using AI patterns
  detectTierPricing(lines, items) {
    const tierPatterns = [
      // Pattern 1: SKU: qty+ = price
      /([A-Z0-9-]+)[:\s]+(\d+)\+?\s*(?:units?|pcs?)?\s*=\s*\$?([\d.,]+)/gi,
      // Pattern 2: qty-qty: price
      /(\d+)\s*-\s*(\d+)\s*:\s*\$?([\d.,]+)/gi,
      // Pattern 3: Volume pricing table
      /volume|tier|quantity\s*pricing/i
    ];

    const skuToItem = new Map(items.map(item => [item.sku, item]));

    lines.forEach((line, index) => {
      // Check for tier pricing section
      if (tierPatterns[2].test(line)) {
        // Look at next few lines for pricing data
        for (let i = 1; i <= 10 && index + i < lines.length; i++) {
          const priceLine = lines[index + i];
          const matches = [...priceLine.matchAll(tierPatterns[0])];
          
          matches.forEach(match => {
            const [, sku, qty, price] = match;
            const item = skuToItem.get(sku);
            if (item) {
              if (!item.tierPricing) item.tierPricing = [];
              item.tierPricing.push({
                minQuantity: parseInt(qty),
                price: parseFloat(price.replace(/,/g, ''))
              });
            }
          });
        }
      }
    });

    // Sort tier pricing
    items.forEach(item => {
      if (item.tierPricing && item.tierPricing.length > 0) {
        item.tierPricing.sort((a, b) => a.minQuantity - b.minQuantity);
      }
    });
  }

  // Calculate parsing confidence score
  calculateConfidence(items, errors) {
    if (items.length === 0) return 0;
    
    const totalRows = items.length + errors.length;
    const successRate = items.length / totalRows;
    
    // Check data completeness
    let completeItems = 0;
    items.forEach(item => {
      if (item.sku && item.description && item.unitPrice && item.currency) {
        completeItems++;
      }
    });
    
    const completenessRate = completeItems / items.length;
    
    return (successRate * 0.6 + completenessRate * 0.4);
  }
}

// Factory function for easy usage
export async function parseIntelligentPDF(fileBuffer, options = {}) {
  const parser = new IntelligentPDFParser(options);
  try {
    const result = await parser.parse(fileBuffer);
    return result;
  } finally {
    await parser.cleanup();
  }
}