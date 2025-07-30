import { describe, it, expect } from '@jest/globals';
import { parseCSV, validateCSVStructure, generateCSVTemplate } from '../csv-parser.js';

describe('CSV Parser', () => {
  describe('parseCSV', () => {
    it('should parse valid CSV with standard headers', async () => {
      const csvContent = `SKU,Description,Unit_Price,Currency,Minimum_Order_Quantity
PROD-001,Widget A,10.50,USD,1
PROD-002,Widget B,25.00,USD,5`;
      
      const buffer = Buffer.from(csvContent);
      const result = await parseCSV(buffer);
      
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toEqual({
        sku: 'PROD-001',
        description: 'Widget A',
        unitPrice: 10.50,
        currency: 'USD',
        minimumOrderQuantity: 1,
        unitOfMeasure: 'EA'
      });
    });

    it('should handle alternative header names', async () => {
      const csvContent = `product_code,name,price,curr,moq
PROD-001,Widget A,10.50,EUR,10`;
      
      const buffer = Buffer.from(csvContent);
      const result = await parseCSV(buffer);
      
      expect(result.success).toBe(true);
      expect(result.data[0]).toEqual({
        sku: 'PROD-001',
        description: 'Widget A',
        unitPrice: 10.50,
        currency: 'EUR',
        minimumOrderQuantity: 10,
        unitOfMeasure: 'EA'
      });
    });

    it('should parse tier pricing', async () => {
      const csvContent = `SKU,Unit_Price,QTY_10,PRICE_10,QTY_50,PRICE_50
PROD-001,10.50,10,9.50,50,8.00`;
      
      const buffer = Buffer.from(csvContent);
      const result = await parseCSV(buffer);
      
      expect(result.success).toBe(true);
      expect(result.data[0].tierPricing).toEqual([
        { minQuantity: 10, price: 9.50 },
        { minQuantity: 50, price: 8.00 }
      ]);
    });

    it('should handle empty rows', async () => {
      const csvContent = `SKU,Unit_Price
PROD-001,10.50

PROD-002,25.00`;
      
      const buffer = Buffer.from(csvContent);
      const result = await parseCSV(buffer);
      
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });

    it('should report errors for invalid data', async () => {
      const csvContent = `SKU,Unit_Price
PROD-001,invalid
,25.00
PROD-003,0`;
      
      const buffer = Buffer.from(csvContent);
      const result = await parseCSV(buffer);
      
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(0);
      expect(result.errors).toHaveLength(3);
      expect(result.errors[0].error).toBe('Invalid unit price');
      expect(result.errors[1].error).toBe('SKU is required');
      expect(result.errors[2].error).toBe('Invalid unit price');
    });

    it('should handle custom delimiters', async () => {
      const csvContent = `SKU;Unit_Price
PROD-001;10.50
PROD-002;25.00`;
      
      const buffer = Buffer.from(csvContent);
      const result = await parseCSV(buffer, { delimiter: ';' });
      
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });
  });

  describe('validateCSVStructure', () => {
    it('should validate CSV with required columns', async () => {
      const csvContent = `SKU,Unit_Price,Description
PROD-001,10.50,Widget A`;
      
      const buffer = Buffer.from(csvContent);
      const validation = await validateCSVStructure(buffer);
      
      expect(validation.valid).toBe(true);
      expect(validation.headers).toEqual(['SKU', 'Unit_Price', 'Description']);
      expect(validation.missingColumns).toHaveLength(0);
    });

    it('should detect missing required columns', async () => {
      const csvContent = `Product_Code,Description
PROD-001,Widget A`;
      
      const buffer = Buffer.from(csvContent);
      const validation = await validateCSVStructure(buffer);
      
      expect(validation.valid).toBe(false);
      expect(validation.missingColumns).toHaveLength(1);
      expect(validation.missingColumns[0].field).toBe('unitPrice');
    });

    it('should add warnings for missing recommended columns', async () => {
      const csvContent = `SKU,Unit_Price
PROD-001,10.50`;
      
      const buffer = Buffer.from(csvContent);
      const validation = await validateCSVStructure(buffer);
      
      expect(validation.valid).toBe(true);
      expect(validation.warnings).toHaveLength(3); // description, currency, minimumOrderQuantity
    });
  });

  describe('generateCSVTemplate', () => {
    it('should generate valid CSV template', () => {
      const template = generateCSVTemplate();
      
      expect(template).toContain('SKU,Description,Unit_Price');
      expect(template).toContain('PROD-001');
      expect(template).toContain('QTY_10,PRICE_10');
      
      const lines = template.split('\n');
      expect(lines).toHaveLength(4); // Header + 3 sample rows
    });
  });
});