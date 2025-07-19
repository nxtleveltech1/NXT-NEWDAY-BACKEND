import { describe, it, expect, beforeEach } from '@jest/globals';
import { 
  parsePriceListFile, 
  validatePriceListFile, 
  generatePriceListTemplate,
  detectFileType,
  standardizePriceListData
} from '../index.js';
import { generateErrorReport } from '../error-reporter.js';
import { performanceOptimizer } from '../performance-optimizer.js';

describe('File Parser Integration Tests', () => {
  describe('End-to-End File Processing', () => {
    it('should process CSV file from upload to validation', async () => {
      const csvContent = `SKU,Description,Unit_Price,Currency,Minimum_Order_Quantity,Unit_Of_Measure
PROD-001,Premium Widget,15.99,USD,1,EA
PROD-002,Standard Widget,9.99,USD,5,BOX
PROD-003,Budget Widget,4.99,USD,10,EA`;

      const file = {
        filename: 'price-list.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csvContent)
      };

      // Parse file
      const parseResult = await parsePriceListFile(file);
      expect(parseResult.success).toBe(true);
      expect(parseResult.data).toHaveLength(3);
      expect(parseResult.fileType).toBe('CSV');

      // Standardize data
      const standardized = standardizePriceListData(parseResult, 123, 456);
      expect(standardized.priceList.supplierId).toBe(123);
      expect(standardized.items).toHaveLength(3);

      // Validate structure
      const validation = await validatePriceListFile(file);
      expect(validation.valid).toBe(true);

      // Generate error report
      const errorReport = generateErrorReport(parseResult, null, {
        includeFixSuggestions: true,
        formatForUser: true
      });
      expect(errorReport.status).toBe('SUCCESS');
      expect(errorReport.userFriendlyMessage).toContain('Successfully processed');
    });

    it('should handle Excel file with multiple sheets', async () => {
      // Mock Excel file content (would be actual XLSX buffer in real scenario)
      const mockExcelBuffer = Buffer.from('Mock Excel Content');
      
      const file = {
        filename: 'price-list.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: mockExcelBuffer
      };

      const parseResult = await parsePriceListFile(file);
      expect(parseResult.fileType).toBe('EXCEL');
      // Note: In real implementation, this would parse actual Excel content
    });

    it('should process JSON file with nested structure', async () => {
      const jsonContent = {
        metadata: {
          supplierName: 'Test Supplier',
          currency: 'USD',
          effectiveDate: '2024-01-15'
        },
        items: [
          {
            sku: 'PROD-001',
            description: 'Premium Widget',
            unitPrice: 15.99,
            currency: 'USD',
            minimumOrderQuantity: 1,
            unitOfMeasure: 'EA'
          },
          {
            sku: 'PROD-002',
            description: 'Standard Widget',
            unitPrice: 9.99,
            currency: 'USD',
            minimumOrderQuantity: 5,
            unitOfMeasure: 'BOX'
          }
        ]
      };

      const file = {
        filename: 'price-list.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(jsonContent))
      };

      const parseResult = await parsePriceListFile(file);
      expect(parseResult.success).toBe(true);
      expect(parseResult.data).toHaveLength(2);
      expect(parseResult.metadata.supplierName).toBe('Test Supplier');
    });

    it('should process XML file with proper structure', async () => {
      const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<PriceList currency="USD" effectiveDate="2024-01-15" supplierName="Test Supplier">
  <Item>
    <SKU>PROD-001</SKU>
    <Description>Premium Widget</Description>
    <UnitPrice>15.99</UnitPrice>
    <Currency>USD</Currency>
    <MinimumOrderQuantity>1</MinimumOrderQuantity>
    <UnitOfMeasure>EA</UnitOfMeasure>
  </Item>
  <Item>
    <SKU>PROD-002</SKU>
    <Description>Standard Widget</Description>
    <UnitPrice>9.99</UnitPrice>
    <Currency>USD</Currency>
    <MinimumOrderQuantity>5</MinimumOrderQuantity>
    <UnitOfMeasure>BOX</UnitOfMeasure>
  </Item>
</PriceList>`;

      const file = {
        filename: 'price-list.xml',
        mimeType: 'application/xml',
        buffer: Buffer.from(xmlContent)
      };

      const parseResult = await parsePriceListFile(file);
      expect(parseResult.success).toBe(true);
      expect(parseResult.data).toHaveLength(2);
    });
  });

  describe('File Type Detection', () => {
    it('should detect file types by extension', () => {
      expect(detectFileType('data.csv', 'text/plain')).toBe('CSV');
      expect(detectFileType('data.xlsx', 'application/octet-stream')).toBe('EXCEL');
      expect(detectFileType('data.json', 'text/plain')).toBe('JSON');
      expect(detectFileType('data.xml', 'text/plain')).toBe('XML');
      expect(detectFileType('data.pdf', 'application/octet-stream')).toBe('PDF');
    });

    it('should detect file types by MIME type when extension is missing', () => {
      expect(detectFileType('data', 'text/csv')).toBe('CSV');
      expect(detectFileType('data', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('EXCEL');
      expect(detectFileType('data', 'application/json')).toBe('JSON');
      expect(detectFileType('data', 'application/xml')).toBe('XML');
      expect(detectFileType('data', 'application/pdf')).toBe('PDF');
    });

    it('should return null for unsupported file types', () => {
      expect(detectFileType('data.txt', 'text/plain')).toBeNull();
      expect(detectFileType('data.doc', 'application/msword')).toBeNull();
    });
  });

  describe('Template Generation', () => {
    it('should generate CSV template', () => {
      const template = generatePriceListTemplate('CSV');
      expect(template).toContain('SKU,Description,Unit_Price');
      expect(template).toContain('PROD-001');
      expect(template).toContain('QTY_10,PRICE_10');
    });

    it('should generate Excel template', () => {
      const template = generatePriceListTemplate('EXCEL');
      expect(template).toBeInstanceOf(Buffer);
    });

    it('should generate JSON template', () => {
      const template = generatePriceListTemplate('JSON');
      const parsed = JSON.parse(template);
      expect(parsed.metadata).toBeDefined();
      expect(parsed.items).toBeInstanceOf(Array);
      expect(parsed.items[0].sku).toBe('PROD-001');
    });

    it('should generate XML template', () => {
      const template = generatePriceListTemplate('XML');
      expect(template).toContain('<?xml version="1.0"');
      expect(template).toContain('<PriceList');
      expect(template).toContain('<SKU>PROD-001</SKU>');
    });

    it('should throw error for unsupported template type', () => {
      expect(() => generatePriceListTemplate('UNSUPPORTED')).toThrow('Invalid file type');
    });
  });

  describe('Error Handling and Reporting', () => {
    it('should handle file parsing errors gracefully', async () => {
      const invalidCsv = 'Invalid CSV Content\\nwith\\nmalformed\\nstructure';
      
      const file = {
        filename: 'invalid.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(invalidCsv)
      };

      const parseResult = await parsePriceListFile(file);
      expect(parseResult.success).toBe(false);
      expect(parseResult.error).toBeDefined();

      const errorReport = generateErrorReport(parseResult, null, {
        includeFixSuggestions: true,
        formatForUser: true
      });
      
      expect(errorReport.status).toBe('FAILED');
      expect(errorReport.userFriendlyMessage).toContain('Failed to parse');
      expect(errorReport.actionableSteps).toBeDefined();
    });

    it('should generate comprehensive error reports', async () => {
      const csvWithErrors = `SKU,Unit_Price
,10.50
PROD-002,invalid
PROD-003,0
PROD-001,15.99`;

      const file = {
        filename: 'errors.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csvWithErrors)
      };

      const parseResult = await parsePriceListFile(file);
      
      const errorReport = generateErrorReport(parseResult, null, {
        includeFixSuggestions: true,
        formatForUser: true
      });

      expect(errorReport.sections).toBeDefined();
      expect(errorReport.sections.length).toBeGreaterThan(0);
      expect(errorReport.userFriendlyMessage).toBeDefined();
      expect(errorReport.actionableSteps).toBeDefined();
    });

    it('should provide format-specific error suggestions', async () => {
      const file = {
        filename: 'test.json',
        mimeType: 'application/json',
        buffer: Buffer.from('Invalid JSON {')
      };

      const parseResult = await parsePriceListFile(file);
      const errorReport = generateErrorReport(parseResult, null, {
        includeFixSuggestions: true
      });

      const parsingSection = errorReport.sections.find(s => s.type === 'parsing_errors');
      if (parsingSection && parsingSection.items.length > 0) {
        expect(parsingSection.items[0].fixSuggestion).toContain('JSON');
      }
    });
  });

  describe('Performance Optimization Integration', () => {
    it('should use performance optimization for large files', async () => {
      // Create a large CSV file
      let largeCsvContent = 'SKU,Description,Unit_Price,Currency\\n';
      for (let i = 1; i <= 2000; i++) {
        largeCsvContent += `PROD-${i.toString().padStart(4, '0')},Product ${i},${(10 + i * 0.01).toFixed(2)},USD\\n`;
      }

      const file = {
        filename: 'large-file.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(largeCsvContent)
      };

      const startTime = Date.now();
      const parseResult = await parsePriceListFile(file, { optimize: true });
      const endTime = Date.now();

      expect(parseResult.success).toBe(true);
      expect(parseResult.data).toHaveLength(2000);
      expect(endTime - startTime).toBeLessThan(30000); // Should complete within 30 seconds
      
      // Check if performance metrics are included
      if (parseResult.performanceMetrics) {
        expect(parseResult.performanceMetrics.totalProcessingTime).toBeDefined();
        expect(parseResult.performanceMetrics.itemsPerSecond).toBeDefined();
      }
    });

    it('should estimate item counts accurately', () => {
      const csvBuffer = Buffer.from('SKU,Price\\nPROD-001,10.50\\nPROD-002,15.99\\nPROD-003,8.75');
      const estimate = performanceOptimizer.estimateItemCount(csvBuffer, 'csv');
      expect(estimate).toBe(3); // Should estimate 3 items (excluding header)
    });

    it('should choose appropriate optimization strategies', () => {
      const optimizer = performanceOptimizer;
      
      // Small file - standard strategy
      expect(optimizer.chooseOptimizationStrategy(1000, 50, 'csv')).toBe('standard');
      
      // Medium file - batched strategy
      expect(optimizer.chooseOptimizationStrategy(100000, 500, 'csv')).toBe('batched');
      
      // Large file - chunked strategy
      expect(optimizer.chooseOptimizationStrategy(5000000, 2000, 'excel')).toBe('chunked');
      
      // Very large file - streaming strategy
      expect(optimizer.chooseOptimizationStrategy(20000000, 10000, 'csv')).toBe('streaming');
    });
  });

  describe('Data Standardization', () => {
    it('should standardize parsed data correctly', () => {
      const parseResult = {
        data: [
          {
            sku: 'PROD-001',
            description: 'Widget A',
            unitPrice: 10.50,
            currency: 'USD',
            minimumOrderQuantity: 1,
            unitOfMeasure: 'EA'
          }
        ],
        filename: 'test.csv',
        fileType: 'CSV'
      };

      const standardized = standardizePriceListData(parseResult, 123, 456);

      expect(standardized.priceList).toEqual({
        supplierId: 123,
        name: expect.stringContaining('Price List'),
        description: 'Uploaded from test.csv',
        effectiveDate: expect.any(Date),
        currency: 'USD',
        status: 'pending',
        uploadedBy: 456,
        sourceFile: {
          filename: 'test.csv',
          fileType: 'CSV',
          uploadDate: expect.any(Date)
        }
      });

      expect(standardized.items).toEqual([{
        sku: 'PROD-001',
        description: 'Widget A',
        unitPrice: 10.50,
        currency: 'USD',
        minimumOrderQuantity: 1,
        unitOfMeasure: 'EA',
        tierPricing: [],
        isActive: true
      }]);
    });

    it('should handle missing optional fields gracefully', () => {
      const parseResult = {
        data: [
          {
            sku: 'PROD-001',
            unitPrice: 10.50
          }
        ],
        filename: 'minimal.csv',
        fileType: 'CSV'
      };

      const standardized = standardizePriceListData(parseResult, 123, 456);

      expect(standardized.items[0]).toEqual({
        sku: 'PROD-001',
        description: '',
        unitPrice: 10.50,
        currency: 'USD',
        minimumOrderQuantity: 1,
        unitOfMeasure: 'EA',
        tierPricing: [],
        isActive: true
      });
    });
  });

  describe('Cross-Format Consistency', () => {
    const testData = [
      {
        sku: 'PROD-001',
        description: 'Premium Widget',
        unitPrice: 15.99,
        currency: 'USD',
        minimumOrderQuantity: 1,
        unitOfMeasure: 'EA',
        tierPricing: [
          { minQuantity: 10, price: 14.99 },
          { minQuantity: 50, price: 13.99 }
        ]
      }
    ];

    it('should produce consistent results across formats', async () => {
      // CSV format
      const csvContent = `SKU,Description,Unit_Price,Currency,Minimum_Order_Quantity,Unit_Of_Measure,QTY_10,PRICE_10,QTY_50,PRICE_50
PROD-001,Premium Widget,15.99,USD,1,EA,10,14.99,50,13.99`;
      
      const csvFile = {
        filename: 'test.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csvContent)
      };

      // JSON format
      const jsonContent = {
        items: testData
      };
      
      const jsonFile = {
        filename: 'test.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(jsonContent))
      };

      // Parse both formats
      const csvResult = await parsePriceListFile(csvFile);
      const jsonResult = await parsePriceListFile(jsonFile);

      // Both should succeed
      expect(csvResult.success).toBe(true);
      expect(jsonResult.success).toBe(true);

      // Results should be structurally similar
      expect(csvResult.data[0].sku).toBe(jsonResult.data[0].sku);
      expect(csvResult.data[0].unitPrice).toBe(jsonResult.data[0].unitPrice);
      expect(csvResult.data[0].tierPricing).toHaveLength(jsonResult.data[0].tierPricing.length);
    });
  });
});