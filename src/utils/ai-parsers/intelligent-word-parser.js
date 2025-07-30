// AI-Enhanced Word Document Parser (.doc, .docx)
// Implements intelligent table extraction and format recognition

import mammoth from 'mammoth';
import { parseStringPromise } from 'xml2js';
import AdmZip from 'adm-zip';
import { IntelligentColumnMapper } from './intelligent-pdf-parser.js';

// Word-specific table patterns
const WORD_TABLE_PATTERNS = {
  // Pattern for detecting price list tables
  priceListIndicators: [
    /price\s*list/i,
    /product\s*catalog/i,
    /item\s*pricing/i,
    /cost\s*sheet/i,
    /quotation/i
  ],
  // Patterns for identifying data rows vs header rows
  headerPatterns: [
    /^(sku|item|product|part)/i,
    /^(description|name|title)/i,
    /^(price|cost|rate)/i,
    /^(quantity|qty|moq)/i
  ]
};

// AI-powered Word table analyzer
class WordTableAnalyzer {
  constructor() {
    this.columnMapper = new IntelligentColumnMapper();
  }

  // Analyze table structure and identify price list tables
  analyzeTables(tables) {
    const priceTables = [];
    
    tables.forEach((table, tableIndex) => {
      const analysis = {
        tableIndex,
        rows: table.length,
        columns: table[0] ? table[0].length : 0,
        isPriceList: false,
        confidence: 0,
        headers: null,
        dataRows: []
      };

      // Check if table contains price list indicators
      const tableText = this.getTableText(table);
      const hasPriceIndicators = WORD_TABLE_PATTERNS.priceListIndicators.some(pattern => 
        pattern.test(tableText)
      );

      // Analyze first row as potential header
      if (table.length > 0) {
        const firstRow = table[0];
        const headerScore = this.scoreAsHeader(firstRow);
        
        if (headerScore > 0.6) {
          analysis.headers = firstRow;
          analysis.dataRows = table.slice(1);
          
          // Map columns using AI
          const mappingResult = this.columnMapper.mapColumns(firstRow);
          analysis.columnMappings = mappingResult.mappings;
          analysis.mappingConfidence = mappingResult.confidence;
        } else {
          // No clear header, analyze column patterns
          analysis.dataRows = table;
          analysis.columnMappings = this.inferColumnMappings(table);
        }
      }

      // Calculate confidence score
      analysis.confidence = this.calculateTableConfidence(analysis, hasPriceIndicators);
      analysis.isPriceList = analysis.confidence > 0.5;

      if (analysis.isPriceList) {
        priceTables.push(analysis);
      }
    });

    return priceTables;
  }

  // Get all text from table for analysis
  getTableText(table) {
    return table.map(row => row.join(' ')).join(' ');
  }

  // Score a row as potential header
  scoreAsHeader(row) {
    let score = 0;
    const totalCells = row.length;
    
    row.forEach(cell => {
      const cellText = cell.toLowerCase().trim();
      
      // Check against header patterns
      const isHeader = WORD_TABLE_PATTERNS.headerPatterns.some(pattern => 
        pattern.test(cellText)
      );
      
      if (isHeader) score += 1;
      
      // Headers typically don't contain numbers
      if (!/\d/.test(cellText)) score += 0.5;
      
      // Headers are usually short
      if (cellText.length < 20) score += 0.3;
    });

    return score / (totalCells * 1.8); // Normalize score
  }

  // Infer column mappings when no header is present
  inferColumnMappings(table) {
    const columnPatterns = [];
    const numColumns = table[0] ? table[0].length : 0;
    
    // Analyze each column
    for (let col = 0; col < numColumns; col++) {
      const columnData = table.map(row => row[col] || '').filter(cell => cell.trim());
      const pattern = this.identifyColumnPattern(columnData);
      columnPatterns.push(pattern);
    }

    // Map patterns to fields
    const mappings = {};
    columnPatterns.forEach((pattern, index) => {
      if (pattern) {
        mappings[pattern] = index;
      }
    });

    return mappings;
  }

  // Identify pattern in column data
  identifyColumnPattern(columnData) {
    const patterns = {
      sku: 0,
      description: 0,
      price: 0,
      quantity: 0,
      currency: 0
    };

    columnData.forEach(cell => {
      const trimmed = cell.trim();
      
      // SKU pattern
      if (/^[A-Z0-9-]{4,}$/i.test(trimmed)) {
        patterns.sku++;
      }
      // Price pattern
      if (/^\$?\d+\.?\d*$/.test(trimmed.replace(/,/g, ''))) {
        patterns.price++;
      }
      // Currency pattern
      if (/^[A-Z]{3}$/.test(trimmed)) {
        patterns.currency++;
      }
      // Quantity pattern
      if (/^\d+$/.test(trimmed) && parseInt(trimmed) < 10000) {
        patterns.quantity++;
      }
      // Description (text without special patterns)
      if (trimmed.length > 10 && !/^\d+$/.test(trimmed)) {
        patterns.description++;
      }
    });

    // Return the most likely pattern
    const maxPattern = Object.entries(patterns).reduce((a, b) => 
      patterns[a[0]] > patterns[b[0]] ? a : b
    );
    
    return maxPattern[1] > columnData.length * 0.3 ? maxPattern[0] : null;
  }

  // Calculate confidence that table is a price list
  calculateTableConfidence(analysis, hasPriceIndicators) {
    let confidence = 0;
    
    // Bonus for price indicators in content
    if (hasPriceIndicators) confidence += 0.3;
    
    // Check for minimum required columns
    const mappings = analysis.columnMappings;
    if (mappings.sku !== undefined) confidence += 0.2;
    if (mappings.price !== undefined) confidence += 0.2;
    if (mappings.description !== undefined) confidence += 0.1;
    
    // Table size indicators
    if (analysis.rows > 3 && analysis.columns >= 3) confidence += 0.1;
    
    // Mapping confidence
    if (analysis.mappingConfidence) {
      confidence += analysis.mappingConfidence * 0.2;
    }

    return Math.min(confidence, 1.0);
  }
}

// Main Word document parser
export class IntelligentWordParser {
  constructor(options = {}) {
    this.options = {
      extractTables: true,
      extractText: true,
      preserveFormatting: false,
      learnedMappingsPath: options.learnedMappingsPath || './.ai-mappings.json',
      ...options
    };
    
    this.tableAnalyzer = new WordTableAnalyzer();
  }

  // Parse Word document
  async parse(fileBuffer, fileExtension = '.docx') {
    try {
      // Load learned mappings
      await this.tableAnalyzer.columnMapper.loadMappings(this.options.learnedMappingsPath);

      let result;
      if (fileExtension === '.docx') {
        result = await this.parseDocx(fileBuffer);
      } else if (fileExtension === '.doc') {
        result = await this.parseDoc(fileBuffer);
      } else {
        throw new Error(`Unsupported file extension: ${fileExtension}`);
      }

      // Save learned mappings
      if (result.data.length > 0) {
        await this.tableAnalyzer.columnMapper.saveMappings(this.options.learnedMappingsPath);
      }

      return result;

    } catch (error) {
      return {
        success: false,
        error: error.message,
        errors: [{ error: error.message, type: 'parsing_error' }],
        parsedCount: 0
      };
    }
  }

  // Parse DOCX files
  async parseDocx(fileBuffer) {
    const items = [];
    const errors = [];
    const metadata = {};

    try {
      // Extract tables and text using mammoth
      const result = await mammoth.convertToHtml({
        buffer: fileBuffer,
        convertImage: mammoth.images.imgElement(function(image) {
          return image.read("base64").then(() => ({ src: "data:image/png;base64,..." }));
        })
      });

      // Also extract raw content for better table detection
      const rawResult = await mammoth.extractRawText({ buffer: fileBuffer });
      
      // Extract tables from DOCX structure
      const tables = await this.extractDocxTables(fileBuffer);
      
      // Analyze tables with AI
      const priceTables = this.tableAnalyzer.analyzeTables(tables);
      
      // Extract items from identified price tables
      priceTables.forEach((tableAnalysis, index) => {
        const tableItems = this.extractItemsFromTable(
          tableAnalysis.dataRows,
          tableAnalysis.columnMappings
        );
        
        tableItems.items.forEach(item => items.push(item));
        tableItems.errors.forEach(error => errors.push({
          ...error,
          table: index + 1
        }));
      });

      // Extract metadata from document text
      if (rawResult.value) {
        Object.assign(metadata, this.extractMetadata(rawResult.value));
      }

      return {
        success: items.length > 0,
        data: items,
        errors,
        parsedCount: items.length,
        metadata,
        tablesFound: tables.length,
        priceTablesIdentified: priceTables.length
      };

    } catch (error) {
      throw error;
    }
  }

  // Parse older .doc files
  async parseDoc(fileBuffer) {
    // For .doc files, we'll use mammoth which handles them as well
    return this.parseDocx(fileBuffer);
  }

  // Extract tables directly from DOCX XML structure
  async extractDocxTables(fileBuffer) {
    const tables = [];
    
    try {
      // DOCX files are ZIP archives
      const zip = new AdmZip(fileBuffer);
      const documentXml = zip.getEntry('word/document.xml');
      
      if (!documentXml) {
        return tables;
      }

      const xmlContent = documentXml.getData().toString('utf8');
      const parsedXml = await parseStringPromise(xmlContent);
      
      // Navigate through the XML structure to find tables
      const body = parsedXml['w:document']['w:body'][0];
      
      if (body['w:tbl']) {
        body['w:tbl'].forEach(tbl => {
          const table = [];
          
          if (tbl['w:tr']) {
            tbl['w:tr'].forEach(tr => {
              const row = [];
              
              if (tr['w:tc']) {
                tr['w:tc'].forEach(tc => {
                  // Extract text from table cell
                  const cellText = this.extractCellText(tc);
                  row.push(cellText);
                });
              }
              
              if (row.length > 0) {
                table.push(row);
              }
            });
          }
          
          if (table.length > 0) {
            tables.push(table);
          }
        });
      }
    } catch (error) {
      console.error('Error extracting DOCX tables:', error);
    }

    return tables;
  }

  // Extract text from table cell XML
  extractCellText(tc) {
    let text = '';
    
    const extractTextFromElement = (element) => {
      if (element['w:p']) {
        element['w:p'].forEach(p => {
          if (p['w:r']) {
            p['w:r'].forEach(r => {
              if (r['w:t']) {
                r['w:t'].forEach(t => {
                  text += (typeof t === 'string' ? t : t['_'] || '');
                });
              }
            });
          }
        });
      }
    };

    extractTextFromElement(tc);
    return text.trim();
  }

  // Extract items from table data
  extractItemsFromTable(rows, columnMappings) {
    const items = [];
    const errors = [];

    rows.forEach((row, index) => {
      try {
        const item = {};
        
        // Extract data based on column mappings
        if (columnMappings.sku !== undefined && row[columnMappings.sku]) {
          item.sku = row[columnMappings.sku].trim();
        }
        if (columnMappings.description !== undefined && row[columnMappings.description]) {
          item.description = row[columnMappings.description].trim();
        }
        if (columnMappings.price !== undefined && row[columnMappings.price]) {
          const priceStr = row[columnMappings.price].replace(/[$,]/g, '').trim();
          item.unitPrice = parseFloat(priceStr);
        }
        if (columnMappings.currency !== undefined && row[columnMappings.currency]) {
          item.currency = row[columnMappings.currency].trim();
        }
        if (columnMappings.quantity !== undefined && row[columnMappings.quantity]) {
          item.minimumOrderQuantity = parseInt(row[columnMappings.quantity]);
        }

        // Apply defaults if needed
        if (!item.currency && item.unitPrice) {
          item.currency = 'USD'; // Default currency
        }
        if (!item.minimumOrderQuantity) {
          item.minimumOrderQuantity = 1;
        }

        // Validate item
        if (item.sku && item.unitPrice && !isNaN(item.unitPrice)) {
          items.push(item);
        } else {
          errors.push({
            row: index + 1,
            error: 'Missing required fields or invalid data',
            data: row.join(' | ')
          });
        }

      } catch (error) {
        errors.push({
          row: index + 1,
          error: error.message,
          data: row.join(' | ')
        });
      }
    });

    return { items, errors };
  }

  // Extract metadata from document text
  extractMetadata(text) {
    const metadata = {};
    const lines = text.split('\n').slice(0, 50); // Check first 50 lines
    
    const patterns = {
      supplierName: /(?:supplier|vendor|company)[:\s]+(.+)/i,
      effectiveDate: /(?:effective|valid|date)[:\s]+(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/i,
      contactEmail: /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/,
      contactPhone: /([\d\s\-\(\)]+(?:ext|x)?\s*\d*)/,
      terms: /(?:terms|payment)[:\s]+(.+)/i
    };

    lines.forEach(line => {
      Object.entries(patterns).forEach(([key, pattern]) => {
        if (!metadata[key]) {
          const match = line.match(pattern);
          if (match) {
            metadata[key] = match[1].trim();
          }
        }
      });
    });

    return metadata;
  }
}

// Factory function for easy usage
export async function parseIntelligentWord(fileBuffer, fileExtension = '.docx', options = {}) {
  const parser = new IntelligentWordParser(options);
  return await parser.parse(fileBuffer, fileExtension);
}