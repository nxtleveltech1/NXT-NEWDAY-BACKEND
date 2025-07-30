import { jest } from '@jest/globals';
import { parseWord } from '../word-parser.js';
import { parseEmail } from '../email-parser.js';
import { parseIntelligentPDF } from '../intelligent-pdf-parser.js';
import { IntelligentColumnMapper } from '../intelligent-column-mapper.js';
import { businessRules } from '../../../services/business-rules.service.js';

describe('Intelligent Parsers', () => {
  describe('Word Parser', () => {
    it('should parse simple Word document with price data', async () => {
      // Mock Word document buffer (would be actual .docx in real test)
      const mockBuffer = Buffer.from('mock-word-content');
      
      const result = await parseWord(mockBuffer, {
        filename: 'supplier-prices.docx',
        intelligentMapping: true
      });
      
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.format).toBe('word');
    });
    
    it('should extract tables from Word documents', async () => {
      // Test table extraction capability
      const mockBuffer = Buffer.from('mock-word-with-tables');
      
      const result = await parseWord(mockBuffer, {
        filename: 'price-table.docx',
        extractTables: true
      });
      
      expect(result.tablesFound).toBeDefined();
    });
  });
  
  describe('Email Parser', () => {
    it('should parse EML format emails', async () => {
      const mockEmlContent = `From: supplier@example.com
To: purchasing@company.com
Subject: Updated Price List
Content-Type: text/plain; charset=UTF-8

Please find our updated prices below:

SKU: PROD-001
Description: Widget A
Price: $25.99
MOQ: 100

SKU: PROD-002
Description: Widget B
Price: $35.50
MOQ: 50`;
      
      const result = await parseEmail(Buffer.from(mockEmlContent), {
        filename: 'price-update.eml',
        format: 'eml'
      });
      
      expect(result.success).toBe(true);
      expect(result.format).toBe('email');
      expect(result.emailMetadata).toBeDefined();
      expect(result.emailMetadata.from).toBe('supplier@example.com');
      expect(result.data).toBeInstanceOf(Array);
    });
    
    it('should process email attachments', async () => {
      // Mock email with attachments
      const mockBuffer = Buffer.from('mock-email-with-attachments');
      
      const result = await parseEmail(mockBuffer, {
        filename: 'email-with-attachments.msg',
        processAttachments: true
      });
      
      expect(result.attachments).toBeDefined();
    });
  });
  
  describe('Intelligent PDF Parser', () => {
    it('should use OCR for scanned PDFs', async () => {
      const mockBuffer = Buffer.from('mock-scanned-pdf');
      
      const result = await parseIntelligentPDF(mockBuffer, {
        filename: 'scanned-prices.pdf',
        enableOCR: true,
        ocrLanguage: 'eng'
      });
      
      expect(result.ocrUsed).toBe(true);
      expect(result.confidence).toBeDefined();
    });
    
    it('should intelligently map columns', async () => {
      const mockBuffer = Buffer.from('mock-pdf-with-tables');
      
      const result = await parseIntelligentPDF(mockBuffer, {
        filename: 'price-list.pdf',
        intelligentMapping: true
      });
      
      expect(result.mapping).toBeDefined();
      expect(result.mappingConfidence).toBeDefined();
    });
  });
  
  describe('Intelligent Column Mapper', () => {
    it('should map common header variations', () => {
      const mapper = new IntelligentColumnMapper();
      const headers = [
        'Product Code',
        'Item Description',
        'Unit Cost',
        'Min Order Qty',
        'UoM',
        'Currency'
      ];
      
      const result = mapper.mapHeaders(headers);
      
      expect(result.mapping.sku).toBe(0); // Product Code -> sku
      expect(result.mapping.description).toBe(1); // Item Description -> description
      expect(result.mapping.unitPrice).toBe(2); // Unit Cost -> unitPrice
      expect(result.mapping.minimumOrderQuantity).toBe(3); // Min Order Qty -> minimumOrderQuantity
      expect(result.mapping.unitOfMeasure).toBe(4); // UoM -> unitOfMeasure
      expect(result.mapping.currency).toBe(5); // Currency -> currency
    });
    
    it('should use fuzzy matching for misspelled headers', () => {
      const mapper = new IntelligentColumnMapper({ fuzzyThreshold: 0.7 });
      const headers = [
        'Prduct Code', // Misspelled
        'Descriptin', // Misspelled
        'Prise', // Misspelled
        'Minimm Order' // Misspelled
      ];
      
      const result = mapper.mapHeaders(headers);
      
      expect(result.mapping.sku).toBe(0);
      expect(result.mapping.description).toBe(1);
      expect(result.mapping.unitPrice).toBe(2);
      expect(result.confidence.sku).toBeGreaterThan(0.7);
    });
    
    it('should learn from user feedback', () => {
      const mapper = new IntelligentColumnMapper({ useML: true });
      
      // Teach the mapper
      mapper.learnFromFeedback('Stock#', 'sku', true);
      mapper.learnFromFeedback('Stock#', 'sku', true);
      mapper.learnFromFeedback('Stock#', 'sku', true);
      
      // Test learned mapping
      const result = mapper.mapSingleHeader('Stock#');
      
      expect(result.field).toBe('sku');
      expect(result.method).toBe('ml');
      expect(result.confidence).toBeGreaterThan(0.8);
    });
  });
  
  describe('Business Rules Integration', () => {
    it('should validate parsed price list items', () => {
      const items = [
        {
          sku: 'PROD-001',
          description: 'Test Product',
          unitPrice: 25.99,
          currency: 'USD',
          minimumOrderQuantity: 10,
          unitOfMeasure: 'EA'
        },
        {
          sku: 'PR', // Too short
          description: 'Bad Product',
          unitPrice: -10, // Negative price
          currency: 'XXX', // Invalid currency
          minimumOrderQuantity: 0,
          unitOfMeasure: 'INVALID'
        }
      ];
      
      const results = items.map(item => businessRules.validatePriceListItem(item));
      
      expect(results[0].valid).toBe(true);
      expect(results[1].valid).toBe(false);
      expect(results[1].errors.length).toBeGreaterThan(0);
    });
    
    it('should check for duplicate SKUs', async () => {
      const newItems = [
        { sku: 'PROD-001', unitPrice: 25.99 },
        { sku: 'PROD-002', unitPrice: 35.50 },
        { sku: 'PROD-001', unitPrice: 28.99 } // Duplicate
      ];
      
      const existingItems = [
        { sku: 'PROD-003', unitPrice: 45.00 }
      ];
      
      const duplicateCheck = await businessRules.checkDuplicateSKUs(newItems, existingItems);
      
      expect(duplicateCheck.hasDuplicates).toBe(true);
      expect(duplicateCheck.duplicates.length).toBe(1);
      expect(duplicateCheck.duplicates[0].sku).toBe('PROD-001');
    });
  });
  
  describe('End-to-End Intelligent Parsing', () => {
    it('should parse and validate complete price list workflow', async () => {
      const mapper = new IntelligentColumnMapper();
      
      // Simulate parsed data with various header formats
      const parsedData = {
        headers: ['Item #', 'Product Name', 'Cost/Unit', 'Min. Qty', 'Unit'],
        data: [
          ['SKU-001', 'Premium Widget', '125.50', '25', 'BOX'],
          ['SKU-002', 'Standard Widget', '75.00', '50', 'EA'],
          ['SKU-003', 'Economy Widget', '45.99', '100', 'CTN']
        ]
      };
      
      // Map headers
      const mappingResult = mapper.mapHeaders(parsedData.headers);
      expect(Object.keys(mappingResult.mapping).length).toBeGreaterThanOrEqual(4);
      
      // Apply mapping
      const mappedItems = mapper.applyMapping(parsedData.data, mappingResult.mapping);
      expect(mappedItems.length).toBe(3);
      
      // Validate with business rules
      const validationResults = mappedItems.map(item => 
        businessRules.validatePriceListItem(item)
      );
      
      expect(validationResults.every(r => r.valid)).toBe(true);
      
      // Check for approval requirements
      const approvalCheck = businessRules.determineApprovalRequired(
        { effectiveDate: new Date() },
        mappedItems
      );
      
      expect(approvalCheck.required).toBeDefined();
      expect(approvalCheck.reasons).toBeInstanceOf(Array);
    });
  });
});

// Integration test with actual file parsing
describe('File Parser Integration', () => {
  it('should integrate with main parser system', async () => {
    const { parsePriceListFile } = await import('../index.js');
    
    // Test Word document parsing
    const wordResult = await parsePriceListFile({
      filename: 'test-prices.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.from('mock-word-content')
    }, {
      intelligentMapping: true
    });
    
    expect(wordResult.fileType).toBe('WORD');
    
    // Test intelligent PDF parsing
    const pdfResult = await parsePriceListFile({
      filename: 'test-prices.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('mock-pdf-content')
    }, {
      intelligentParsing: true
    });
    
    expect(pdfResult.fileType).toBe('INTELLIGENT_PDF');
  });
});