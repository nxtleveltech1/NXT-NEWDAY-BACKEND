// AI-Enhanced Email Parser (.eml, .msg)
// Implements intelligent attachment extraction and price list detection

import { simpleParser } from 'mailparser';
import MsgReader from '@kenjiuno/msgreader';
import { IntelligentPDFParser } from './intelligent-pdf-parser.js';
import { IntelligentWordParser } from './intelligent-word-parser.js';
import { IntelligentColumnMapper } from './intelligent-pdf-parser.js';
import natural from 'natural';

// Email content patterns for price list detection
const EMAIL_PATTERNS = {
  priceListIndicators: [
    /price\s*list/i,
    /quotation/i,
    /cost\s*sheet/i,
    /product\s*catalog/i,
    /pricing\s*information/i,
    /attached\s*(?:please\s*find|is|are)\s*(?:the\s*)?price/i,
    /rates?\s*(?:sheet|list|table)/i
  ],
  tablePatterns: [
    // HTML table patterns
    /<table[^>]*>[\s\S]*?<\/table>/gi,
    // Plain text table patterns
    /^[|\s]*([^|\n]+\|){2,}[^|\n]+[|\s]*$/gm,
    // Tab-separated values
    /^([^\t\n]+\t){2,}[^\t\n]+$/gm
  ],
  attachmentIndicators: [
    /see\s*attached/i,
    /attachment/i,
    /please\s*find\s*attached/i,
    /enclosed/i
  ]
};

// AI-powered email content analyzer
class EmailContentAnalyzer {
  constructor() {
    this.columnMapper = new IntelligentColumnMapper();
    this.tokenizer = new natural.WordTokenizer();
    this.classifier = new natural.BayesClassifier();
    this.trainClassifier();
  }

  // Train classifier for email content classification
  trainClassifier() {
    // Price list emails
    this.classifier.addDocument('please find attached our latest price list', 'price_list');
    this.classifier.addDocument('quotation for your requested items', 'price_list');
    this.classifier.addDocument('product catalog with current pricing', 'price_list');
    this.classifier.addDocument('here are the rates as discussed', 'price_list');
    
    // Non-price list emails
    this.classifier.addDocument('meeting scheduled for tomorrow', 'other');
    this.classifier.addDocument('thank you for your order', 'other');
    this.classifier.addDocument('invoice for services rendered', 'other');
    
    this.classifier.train();
  }

  // Analyze email content for price lists
  analyzeEmailContent(email) {
    const analysis = {
      hasPriceList: false,
      confidence: 0,
      priceListLocation: null,
      attachmentsToProcess: [],
      inlineData: null
    };

    // Classify email content
    const classification = this.classifier.classify(email.subject + ' ' + email.text);
    const classifications = this.classifier.getClassifications(email.subject + ' ' + email.text);
    
    // Check confidence
    const priceListConfidence = classifications.find(c => c.label === 'price_list');
    if (priceListConfidence) {
      analysis.confidence = priceListConfidence.value;
    }

    // Check for price list indicators in content
    const contentToCheck = (email.subject + ' ' + email.text + ' ' + email.html).toLowerCase();
    const hasPriceIndicators = EMAIL_PATTERNS.priceListIndicators.some(pattern => 
      pattern.test(contentToCheck)
    );

    if (hasPriceIndicators || analysis.confidence > 0.6) {
      analysis.hasPriceList = true;
      
      // Determine location of price data
      if (EMAIL_PATTERNS.attachmentIndicators.some(p => p.test(contentToCheck))) {
        analysis.priceListLocation = 'attachment';
        
        // Identify relevant attachments
        if (email.attachments) {
          analysis.attachmentsToProcess = this.identifyRelevantAttachments(email.attachments);
        }
      }

      // Check for inline tables
      const inlineTables = this.extractInlineTables(email);
      if (inlineTables.length > 0) {
        analysis.priceListLocation = analysis.priceListLocation ? 'both' : 'inline';
        analysis.inlineData = inlineTables;
      }
    }

    return analysis;
  }

  // Identify attachments likely to contain price lists
  identifyRelevantAttachments(attachments) {
    const relevantExtensions = ['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.csv'];
    const relevantPatterns = [
      /price/i,
      /catalog/i,
      /quotation/i,
      /rates/i,
      /products/i,
      /items/i
    ];

    return attachments.filter(att => {
      // Check file extension
      const hasRelevantExtension = relevantExtensions.some(ext => 
        att.filename.toLowerCase().endsWith(ext)
      );
      
      // Check filename patterns
      const hasRelevantName = relevantPatterns.some(pattern => 
        pattern.test(att.filename)
      );

      // Include if either condition is met
      return hasRelevantExtension || hasRelevantName;
    });
  }

  // Extract tables from email body
  extractInlineTables(email) {
    const tables = [];
    
    // Extract from HTML content
    if (email.html) {
      const htmlTables = this.extractHTMLTables(email.html);
      tables.push(...htmlTables);
    }

    // Extract from plain text
    if (email.text) {
      const textTables = this.extractTextTables(email.text);
      tables.push(...textTables);
    }

    return tables;
  }

  // Extract tables from HTML content
  extractHTMLTables(html) {
    const tables = [];
    const tableMatches = html.match(EMAIL_PATTERNS.tablePatterns[0]) || [];
    
    tableMatches.forEach(tableHtml => {
      // Parse HTML table
      const rows = [];
      const rowMatches = tableHtml.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
      
      rowMatches.forEach(rowHtml => {
        const cells = [];
        const cellMatches = rowHtml.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || [];
        
        cellMatches.forEach(cellHtml => {
          const text = cellHtml.replace(/<[^>]+>/g, '').trim();
          cells.push(text);
        });
        
        if (cells.length > 0) {
          rows.push(cells);
        }
      });
      
      if (rows.length > 0) {
        tables.push(rows);
      }
    });

    return tables;
  }

  // Extract tables from plain text
  extractTextTables(text) {
    const tables = [];
    const lines = text.split('\n');
    let currentTable = [];
    let inTable = false;

    lines.forEach(line => {
      // Check if line looks like table row
      const isPipeTable = EMAIL_PATTERNS.tablePatterns[1].test(line);
      const isTabTable = EMAIL_PATTERNS.tablePatterns[2].test(line);
      
      if (isPipeTable || isTabTable) {
        inTable = true;
        let cells;
        
        if (isPipeTable) {
          cells = line.split('|').map(cell => cell.trim()).filter(cell => cell);
        } else {
          cells = line.split('\t').map(cell => cell.trim());
        }
        
        currentTable.push(cells);
      } else if (inTable && line.trim() === '') {
        // End of table
        if (currentTable.length > 1) {
          tables.push(currentTable);
        }
        currentTable = [];
        inTable = false;
      }
    });

    // Don't forget last table
    if (currentTable.length > 1) {
      tables.push(currentTable);
    }

    return tables;
  }
}

// Main email parser
export class IntelligentEmailParser {
  constructor(options = {}) {
    this.options = {
      processAttachments: true,
      extractInlineTables: true,
      learnedMappingsPath: options.learnedMappingsPath || './.ai-mappings.json',
      ...options
    };
    
    this.contentAnalyzer = new EmailContentAnalyzer();
    this.pdfParser = new IntelligentPDFParser(options);
    this.wordParser = new IntelligentWordParser(options);
  }

  // Parse email file
  async parse(fileBuffer, fileExtension = '.eml') {
    try {
      let email;
      
      if (fileExtension === '.eml') {
        email = await this.parseEML(fileBuffer);
      } else if (fileExtension === '.msg') {
        email = await this.parseMSG(fileBuffer);
      } else {
        throw new Error(`Unsupported email format: ${fileExtension}`);
      }

      // Analyze email content
      const analysis = this.contentAnalyzer.analyzeEmailContent(email);
      
      // Extract price data
      const result = await this.extractPriceData(email, analysis);
      
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

  // Parse .eml files
  async parseEML(fileBuffer) {
    const parsed = await simpleParser(fileBuffer);
    
    return {
      subject: parsed.subject || '',
      from: parsed.from?.text || '',
      to: parsed.to?.text || '',
      date: parsed.date || new Date(),
      text: parsed.text || '',
      html: parsed.html || '',
      attachments: parsed.attachments || []
    };
  }

  // Parse .msg files
  async parseMSG(fileBuffer) {
    const msgReader = new MsgReader(fileBuffer);
    const fileData = msgReader.getFileData();
    
    return {
      subject: fileData.subject || '',
      from: fileData.senderName || '',
      to: fileData.recipients?.map(r => r.name).join(', ') || '',
      date: fileData.creationTime || new Date(),
      text: fileData.body || '',
      html: fileData.bodyHTML || '',
      attachments: fileData.attachments?.map(att => ({
        filename: att.fileName,
        content: att.content,
        contentType: att.mimeType || 'application/octet-stream'
      })) || []
    };
  }

  // Extract price data from email and attachments
  async extractPriceData(email, analysis) {
    const allItems = [];
    const allErrors = [];
    const metadata = {
      emailSubject: email.subject,
      emailFrom: email.from,
      emailDate: email.date,
      hasPriceList: analysis.hasPriceList,
      confidence: analysis.confidence
    };

    // Process inline tables if found
    if (analysis.inlineData && analysis.inlineData.length > 0) {
      const inlineResult = await this.processInlineTables(analysis.inlineData);
      allItems.push(...inlineResult.items);
      allErrors.push(...inlineResult.errors);
    }

    // Process attachments
    if (this.options.processAttachments && analysis.attachmentsToProcess.length > 0) {
      for (const attachment of analysis.attachmentsToProcess) {
        const attachmentResult = await this.processAttachment(attachment);
        
        if (attachmentResult.success) {
          allItems.push(...attachmentResult.data);
          metadata[`attachment_${attachment.filename}`] = {
            itemsFound: attachmentResult.data.length,
            errors: attachmentResult.errors.length
          };
        } else {
          allErrors.push({
            attachment: attachment.filename,
            error: attachmentResult.error
          });
        }
      }
    }

    // Extract additional metadata from email body
    const bodyMetadata = this.extractEmailMetadata(email.text + '\n' + email.html);
    Object.assign(metadata, bodyMetadata);

    return {
      success: allItems.length > 0 || (analysis.hasPriceList && allErrors.length === 0),
      data: allItems,
      errors: allErrors,
      parsedCount: allItems.length,
      metadata,
      attachmentsProcessed: analysis.attachmentsToProcess.length,
      inlineTablesFound: analysis.inlineData ? analysis.inlineData.length : 0
    };
  }

  // Process inline tables from email body
  async processInlineTables(tables) {
    const items = [];
    const errors = [];

    // Load learned mappings
    await this.contentAnalyzer.columnMapper.loadMappings(this.options.learnedMappingsPath);

    tables.forEach((table, tableIndex) => {
      try {
        // Analyze table structure
        let headers = null;
        let dataRows = table;

        // Check if first row is header
        if (table.length > 0) {
          const firstRowText = table[0].join(' ').toLowerCase();
          if (firstRowText.includes('price') || firstRowText.includes('sku') || 
              firstRowText.includes('product')) {
            headers = table[0];
            dataRows = table.slice(1);
          }
        }

        // Map columns
        let columnMappings = {};
        if (headers) {
          const mappingResult = this.contentAnalyzer.columnMapper.mapColumns(headers);
          columnMappings = mappingResult.mappings;
        }

        // Extract items
        dataRows.forEach((row, rowIndex) => {
          try {
            const item = this.parseTableRow(row, columnMappings);
            if (item && item.sku && item.unitPrice) {
              items.push(item);
            }
          } catch (error) {
            errors.push({
              table: tableIndex + 1,
              row: rowIndex + 1,
              error: error.message
            });
          }
        });

      } catch (error) {
        errors.push({
          table: tableIndex + 1,
          error: `Table processing failed: ${error.message}`
        });
      }
    });

    // Save learned mappings
    if (items.length > 0) {
      await this.contentAnalyzer.columnMapper.saveMappings(this.options.learnedMappingsPath);
    }

    return { items, errors };
  }

  // Parse a single table row
  parseTableRow(row, mappings) {
    const item = {};

    // Use mappings if available
    if (mappings.sku !== undefined) {
      item.sku = row[mappings.sku]?.trim();
    }
    if (mappings.description !== undefined) {
      item.description = row[mappings.description]?.trim();
    }
    if (mappings.price !== undefined) {
      const priceStr = row[mappings.price]?.replace(/[$,]/g, '').trim();
      item.unitPrice = parseFloat(priceStr);
    }
    if (mappings.currency !== undefined) {
      item.currency = row[mappings.currency]?.trim();
    }
    if (mappings.quantity !== undefined) {
      item.minimumOrderQuantity = parseInt(row[mappings.quantity]);
    }

    // Try to infer if no mappings
    if (Object.keys(mappings).length === 0) {
      row.forEach((cell, index) => {
        const trimmed = cell?.trim() || '';
        
        // SKU pattern
        if (!item.sku && /^[A-Z0-9-]{4,}$/i.test(trimmed)) {
          item.sku = trimmed;
        }
        // Price pattern
        else if (!item.unitPrice && /^\$?\d+\.?\d*$/.test(trimmed.replace(/,/g, ''))) {
          item.unitPrice = parseFloat(trimmed.replace(/[$,]/g, ''));
        }
        // Description
        else if (!item.description && trimmed.length > 5 && !/^\d+$/.test(trimmed)) {
          item.description = trimmed;
        }
      });
    }

    // Apply defaults
    if (!item.currency && item.unitPrice) {
      item.currency = 'USD';
    }
    if (!item.minimumOrderQuantity) {
      item.minimumOrderQuantity = 1;
    }

    return item;
  }

  // Process email attachment
  async processAttachment(attachment) {
    const filename = attachment.filename.toLowerCase();
    
    try {
      if (filename.endsWith('.pdf')) {
        return await this.pdfParser.parse(attachment.content);
      } else if (filename.endsWith('.docx') || filename.endsWith('.doc')) {
        const ext = filename.endsWith('.docx') ? '.docx' : '.doc';
        return await this.wordParser.parse(attachment.content, ext);
      } else if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
        // Would use Excel parser here
        return {
          success: false,
          error: 'Excel parsing not implemented in this example'
        };
      } else if (filename.endsWith('.csv')) {
        // Would use CSV parser here
        return {
          success: false,
          error: 'CSV parsing not implemented in this example'
        };
      } else {
        return {
          success: false,
          error: `Unsupported attachment type: ${filename}`
        };
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to process attachment ${filename}: ${error.message}`
      };
    }
  }

  // Extract metadata from email body
  extractEmailMetadata(content) {
    const metadata = {};
    const patterns = {
      orderNumber: /order\s*#?\s*([A-Z0-9-]+)/i,
      quoteNumber: /quote\s*#?\s*([A-Z0-9-]+)/i,
      validUntil: /valid\s*until\s*([^,\n]+)/i,
      terms: /terms[:\s]+([^\n]+)/i,
      discount: /discount[:\s]+(\d+%?)/i
    };

    Object.entries(patterns).forEach(([key, pattern]) => {
      const match = content.match(pattern);
      if (match) {
        metadata[key] = match[1].trim();
      }
    });

    return metadata;
  }
}

// Factory function for easy usage
export async function parseIntelligentEmail(fileBuffer, fileExtension = '.eml', options = {}) {
  const parser = new IntelligentEmailParser(options);
  return await parser.parse(fileBuffer, fileExtension);
}