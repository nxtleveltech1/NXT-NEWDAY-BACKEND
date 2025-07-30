import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { parseExcel, validateExcelStructure, generateExcelTemplate } from '../excel-parser.js';
import XLSX from 'xlsx';

// Mock XLSX library
jest.mock('xlsx', () => ({
  read: jest.fn(),
  utils: {
    sheet_to_json: jest.fn(),
    json_to_sheet: jest.fn(),
    book_new: jest.fn(),
    book_append_sheet: jest.fn()
  },
  writeFile: jest.fn()
}));

describe('Excel Parser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('parseExcel', () => {
    test('should parse valid Excel file with price list data', async () => {
      const mockWorkbook = {
        SheetNames: ['Price List'],
        Sheets: {
          'Price List': {}
        }
      };

      const mockData = [
        {
          'SKU': 'PROD001',
          'Description': 'Product 1',
          'Unit Price': 10.99,
          'Currency': 'USD',
          'Min Order Qty': 10,
          'Unit of Measure': 'EA'
        },
        {
          'SKU': 'PROD002',
          'Description': 'Product 2',
          'Unit Price': 25.50,
          'Currency': 'USD',
          'Min Order Qty': 5,
          'Unit of Measure': 'CS'
        }
      ];

      XLSX.read.mockReturnValue(mockWorkbook);
      XLSX.utils.sheet_to_json.mockReturnValue(mockData);

      const buffer = Buffer.from('mock excel data');
      const result = await parseExcel(buffer);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toEqual({
        sku: 'PROD001',
        description: 'Product 1',
        unitPrice: 10.99,
        currency: 'USD',
        minimumOrderQuantity: 10,
        unitOfMeasure: 'EA'
      });
      expect(XLSX.read).toHaveBeenCalledWith(buffer, { type: 'buffer' });
    });

    test('should handle tier pricing columns', async () => {
      const mockData = [
        {
          'SKU': 'PROD001',
          'Description': 'Product 1',
          'Unit Price': 10.99,
          'Tier 1 Qty': 100,
          'Tier 1 Price': 9.99,
          'Tier 2 Qty': 500,
          'Tier 2 Price': 8.99,
          'Tier 3 Qty': 1000,
          'Tier 3 Price': 7.99
        }
      ];

      XLSX.read.mockReturnValue({ SheetNames: ['Sheet1'], Sheets: { 'Sheet1': {} } });
      XLSX.utils.sheet_to_json.mockReturnValue(mockData);

      const result = await parseExcel(Buffer.from('mock'));

      expect(result.success).toBe(true);
      expect(result.data[0].tierPricing).toHaveLength(3);
      expect(result.data[0].tierPricing[0]).toEqual({
        minQuantity: 100,
        unitPrice: 9.99
      });
    });

    test('should handle multiple sheets', async () => {
      const mockWorkbook = {
        SheetNames: ['Products', 'Services'],
        Sheets: {
          'Products': {},
          'Services': {}
        }
      };

      const productsData = [
        { 'SKU': 'PROD001', 'Description': 'Product 1', 'Unit Price': 10.99 }
      ];
      const servicesData = [
        { 'SKU': 'SERV001', 'Description': 'Service 1', 'Unit Price': 99.99 }
      ];

      XLSX.read.mockReturnValue(mockWorkbook);
      XLSX.utils.sheet_to_json
        .mockReturnValueOnce(productsData)
        .mockReturnValueOnce(servicesData);

      const result = await parseExcel(Buffer.from('mock'));

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data[0].sku).toBe('PROD001');
      expect(result.data[1].sku).toBe('SERV001');
    });

    test('should handle empty Excel file', async () => {
      XLSX.read.mockReturnValue({ SheetNames: [], Sheets: {} });

      const result = await parseExcel(Buffer.from('mock'));

      expect(result.success).toBe(false);
      expect(result.error).toBe('No sheets found in Excel file');
    });

    test('should handle corrupted Excel file', async () => {
      XLSX.read.mockImplementation(() => {
        throw new Error('File format is not valid');
      });

      const result = await parseExcel(Buffer.from('corrupted'));

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to parse Excel file');
    });

    test('should handle missing required columns', async () => {
      const mockData = [
        {
          'Description': 'Product 1',  // Missing SKU
          'Unit Price': 10.99
        }
      ];

      XLSX.read.mockReturnValue({ SheetNames: ['Sheet1'], Sheets: { 'Sheet1': {} } });
      XLSX.utils.sheet_to_json.mockReturnValue(mockData);

      const result = await parseExcel(Buffer.from('mock'));

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required column: SKU');
    });

    test('should handle various column name formats', async () => {
      const mockData = [
        {
          'sku': 'PROD001',  // lowercase
          'Product Description': 'Product 1',  // different name
          'price': 10.99,  // lowercase
          'MOQ': 10  // abbreviation
        }
      ];

      XLSX.read.mockReturnValue({ SheetNames: ['Sheet1'], Sheets: { 'Sheet1': {} } });
      XLSX.utils.sheet_to_json.mockReturnValue(mockData);

      const result = await parseExcel(Buffer.from('mock'), {
        columnMapping: {
          'sku': 'sku',
          'Product Description': 'description',
          'price': 'unitPrice',
          'MOQ': 'minimumOrderQuantity'
        }
      });

      expect(result.success).toBe(true);
      expect(result.data[0]).toMatchObject({
        sku: 'PROD001',
        description: 'Product 1',
        unitPrice: 10.99,
        minimumOrderQuantity: 10
      });
    });

    test('should handle large Excel files', async () => {
      const largeData = Array(10000).fill(null).map((_, i) => ({
        'SKU': `PROD${i.toString().padStart(5, '0')}`,
        'Description': `Product ${i}`,
        'Unit Price': Math.random() * 100,
        'Currency': 'USD',
        'Min Order Qty': Math.floor(Math.random() * 100) + 1
      }));

      XLSX.read.mockReturnValue({ SheetNames: ['Sheet1'], Sheets: { 'Sheet1': {} } });
      XLSX.utils.sheet_to_json.mockReturnValue(largeData);

      const result = await parseExcel(Buffer.from('large file'));

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(10000);
      expect(result.metadata.totalRows).toBe(10000);
    });

    test('should handle different number formats', async () => {
      const mockData = [
        {
          'SKU': 'PROD001',
          'Description': 'Product 1',
          'Unit Price': '10.99',  // String
          'Min Order Qty': '10'    // String
        },
        {
          'SKU': 'PROD002',
          'Description': 'Product 2',
          'Unit Price': 25.5,      // Number without decimals
          'Min Order Qty': 5.0     // Float
        }
      ];

      XLSX.read.mockReturnValue({ SheetNames: ['Sheet1'], Sheets: { 'Sheet1': {} } });
      XLSX.utils.sheet_to_json.mockReturnValue(mockData);

      const result = await parseExcel(Buffer.from('mock'));

      expect(result.success).toBe(true);
      expect(result.data[0].unitPrice).toBe(10.99);
      expect(result.data[0].minimumOrderQuantity).toBe(10);
      expect(result.data[1].unitPrice).toBe(25.5);
      expect(result.data[1].minimumOrderQuantity).toBe(5);
    });

    test('should skip empty rows', async () => {
      const mockData = [
        { 'SKU': 'PROD001', 'Description': 'Product 1', 'Unit Price': 10.99 },
        { 'SKU': '', 'Description': '', 'Unit Price': '' },  // Empty row
        { 'SKU': 'PROD002', 'Description': 'Product 2', 'Unit Price': 25.50 },
        {},  // Completely empty row
        { 'SKU': 'PROD003', 'Description': 'Product 3', 'Unit Price': 15.00 }
      ];

      XLSX.read.mockReturnValue({ SheetNames: ['Sheet1'], Sheets: { 'Sheet1': {} } });
      XLSX.utils.sheet_to_json.mockReturnValue(mockData);

      const result = await parseExcel(Buffer.from('mock'));

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(3);
      expect(result.data[2].sku).toBe('PROD003');
    });
  });

  describe('validateExcelStructure', () => {
    test('should validate correct Excel structure', async () => {
      const mockWorkbook = {
        SheetNames: ['Price List'],
        Sheets: {
          'Price List': {}
        }
      };

      const mockData = [
        {
          'SKU': 'PROD001',
          'Description': 'Product 1',
          'Unit Price': 10.99,
          'Currency': 'USD'
        }
      ];

      XLSX.read.mockReturnValue(mockWorkbook);
      XLSX.utils.sheet_to_json.mockReturnValue(mockData);

      const result = await validateExcelStructure(Buffer.from('mock'));

      expect(result.valid).toBe(true);
      expect(result.sheets).toHaveLength(1);
      expect(result.sheets[0].columns).toContain('SKU');
    });

    test('should detect missing required columns', async () => {
      const mockData = [
        {
          'Description': 'Product 1',
          'Currency': 'USD'
          // Missing SKU and Unit Price
        }
      ];

      XLSX.read.mockReturnValue({ SheetNames: ['Sheet1'], Sheets: { 'Sheet1': {} } });
      XLSX.utils.sheet_to_json.mockReturnValue(mockData);

      const result = await validateExcelStructure(Buffer.from('mock'));

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required column: SKU');
      expect(result.errors).toContain('Missing required column: Unit Price');
    });

    test('should provide warnings for optional missing columns', async () => {
      const mockData = [
        {
          'SKU': 'PROD001',
          'Description': 'Product 1',
          'Unit Price': 10.99
          // Missing Currency, MOQ, UOM
        }
      ];

      XLSX.read.mockReturnValue({ SheetNames: ['Sheet1'], Sheets: { 'Sheet1': {} } });
      XLSX.utils.sheet_to_json.mockReturnValue(mockData);

      const result = await validateExcelStructure(Buffer.from('mock'));

      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('Missing optional column: Currency');
    });
  });

  describe('generateExcelTemplate', () => {
    test('should generate Excel template with all columns', () => {
      const mockWorkbook = {};
      const mockSheet = {};

      XLSX.utils.book_new.mockReturnValue(mockWorkbook);
      XLSX.utils.json_to_sheet.mockReturnValue(mockSheet);

      const result = generateExcelTemplate();

      expect(result.success).toBe(true);
      expect(result.filename).toBe('price_list_template.xlsx');
      expect(XLSX.utils.json_to_sheet).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            'SKU': 'PROD001',
            'Description': 'Product Description',
            'Unit Price': 0.00
          })
        ])
      );
      expect(XLSX.utils.book_append_sheet).toHaveBeenCalledWith(
        mockWorkbook,
        mockSheet,
        'Price List Template'
      );
    });

    test('should include example data in template', () => {
      XLSX.utils.book_new.mockReturnValue({});
      XLSX.utils.json_to_sheet.mockReturnValue({});

      generateExcelTemplate();

      expect(XLSX.utils.json_to_sheet).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            'SKU': 'PROD001'
          }),
          expect.objectContaining({
            'SKU': 'PROD002'
          }),
          expect.objectContaining({
            'SKU': 'PROD003'
          })
        ])
      );
    });
  });

  describe('Excel format edge cases', () => {
    test('should handle formulas in cells', async () => {
      const mockData = [
        {
          'SKU': 'PROD001',
          'Description': 'Product 1',
          'Unit Price': { f: '=B2*1.1' },  // Formula
          'Currency': 'USD'
        }
      ];

      XLSX.read.mockReturnValue({ SheetNames: ['Sheet1'], Sheets: { 'Sheet1': {} } });
      XLSX.utils.sheet_to_json.mockReturnValue(mockData);

      const result = await parseExcel(Buffer.from('mock'));

      expect(result.success).toBe(false);
      expect(result.error).toContain('Formula detected in Unit Price');
    });

    test('should handle date formats', async () => {
      const mockData = [
        {
          'SKU': 'PROD001',
          'Description': 'Product 1',
          'Unit Price': 10.99,
          'Effective Date': new Date('2024-01-01'),
          'Expiry Date': '2024-12-31'
        }
      ];

      XLSX.read.mockReturnValue({ SheetNames: ['Sheet1'], Sheets: { 'Sheet1': {} } });
      XLSX.utils.sheet_to_json.mockReturnValue(mockData);

      const result = await parseExcel(Buffer.from('mock'));

      expect(result.success).toBe(true);
      expect(result.data[0].effectiveDate).toBe('2024-01-01');
      expect(result.data[0].expiryDate).toBe('2024-12-31');
    });

    test('should handle special characters in SKUs', async () => {
      const mockData = [
        {
          'SKU': 'PROD-001/A',
          'Description': 'Product with special chars',
          'Unit Price': 10.99
        },
        {
          'SKU': 'PROD#002@B',
          'Description': 'Another special product',
          'Unit Price': 20.99
        }
      ];

      XLSX.read.mockReturnValue({ SheetNames: ['Sheet1'], Sheets: { 'Sheet1': {} } });
      XLSX.utils.sheet_to_json.mockReturnValue(mockData);

      const result = await parseExcel(Buffer.from('mock'));

      expect(result.success).toBe(true);
      expect(result.data[0].sku).toBe('PROD-001/A');
      expect(result.data[1].sku).toBe('PROD#002@B');
    });
  });
});