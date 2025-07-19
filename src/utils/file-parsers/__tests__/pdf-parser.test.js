import { describe, it, expect, beforeEach } from '@jest/globals';
import { parsePDF, validatePDFStructure, analyzePDF } from '../pdf-parser.js';

describe('PDF Parser', () => {
  let mockPdfBuffer;

  beforeEach(() => {
    // Mock PDF buffer with header
    mockPdfBuffer = Buffer.from('%PDF-1.4\\nPrice List Report\\nSupplier: Test Supplier Inc.\\nEffective Date: 2024-01-15\\n\\nSKU          Description              Unit Price  Currency  MOQ  UOM\\nPROD-001     Widget A                 10.50       USD       1    EA\\nPROD-002     Widget B                 25.00       USD       5    BOX\\nPROD-003     Widget C                 5.75        USD       1    EA\\n\\nTier Pricing:\\nPROD-001: 10+ units = $9.50, 50+ units = $8.75, 100+ units = $8.00\\nPROD-002: 10+ units = $23.00, 50+ units = $21.00, 100+ units = $19.50\\n\\nEnd of Report');
  });

  describe('parsePDF', () => {
    it('should parse valid PDF with table structure', async () => {
      const result = await parsePDF(mockPdfBuffer);
      
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(3);
      expect(result.data[0]).toEqual({
        sku: 'PROD-001',
        description: 'Widget A',
        unitPrice: 10.50,
        currency: 'USD',
        minimumOrderQuantity: 1,
        unitOfMeasure: 'EA',
        tierPricing: expect.arrayContaining([
          { minQuantity: 10, price: 9.50 },
          { minQuantity: 50, price: 8.75 },
          { minQuantity: 100, price: 8.00 }
        ])
      });
    });

    it('should extract metadata from PDF', async () => {
      const result = await parsePDF(mockPdfBuffer);
      
      expect(result.success).toBe(true);
      expect(result.metadata).toEqual({
        supplierName: 'Test Supplier Inc.',
        effectiveDate: '2024-01-15'
      });
    });

    it('should handle PDF without table structure', async () => {
      const invalidBuffer = Buffer.from('%PDF-1.4\\nNo table structure here\\nJust random text');
      const result = await parsePDF(invalidBuffer);
      
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(0); // No parsing errors, just no data
      expect(result.data).toHaveLength(0);
    });

    it('should report errors for malformed table rows', async () => {
      const malformedBuffer = Buffer.from('%PDF-1.4\\nSKU          Description              Unit Price  Currency  MOQ  UOM\\nPROD-001     Widget A                 invalid     USD       1    EA\\n           Incomplete row');
      const result = await parsePDF(malformedBuffer);
      
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle custom extraction options', async () => {
      const result = await parsePDF(mockPdfBuffer, {
        extractionMethod: 'text',
        tableDetection: 'pattern'
      });
      
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(3);
    });
  });

  describe('validatePDFStructure', () => {
    it('should validate PDF with proper table structure', async () => {
      const validation = await validatePDFStructure(mockPdfBuffer);
      
      expect(validation.valid).toBe(true);
      expect(validation.estimatedItemCount).toBe(3);
      expect(validation.warnings).toHaveLength(0);
    });

    it('should reject invalid PDF format', async () => {
      const invalidBuffer = Buffer.from('Not a PDF file');
      const validation = await validatePDFStructure(invalidBuffer);
      
      expect(validation.valid).toBe(false);
      expect(validation.error).toContain('Invalid PDF file format');
    });

    it('should warn about PDFs without table structure', async () => {
      const noTableBuffer = Buffer.from('%PDF-1.4\\nNo table structure here');
      const validation = await validatePDFStructure(noTableBuffer);
      
      expect(validation.valid).toBe(false);
      expect(validation.error).toContain('No price list table found');
      expect(validation.warnings).toContain('Consider converting PDF to CSV or Excel format for better accuracy');
    });

    it('should detect table structure but warn about no data', async () => {
      const emptyTableBuffer = Buffer.from('%PDF-1.4\\nSKU          Description              Unit Price  Currency  MOQ  UOM\\n');
      const validation = await validatePDFStructure(emptyTableBuffer);
      
      expect(validation.valid).toBe(true);
      expect(validation.estimatedItemCount).toBe(0);
      expect(validation.warnings).toContain('Table structure found but no data rows detected. Please verify PDF format.');
    });
  });

  describe('analyzePDF', () => {
    it('should analyze text-based PDF correctly', async () => {
      const analysis = await analyzePDF(mockPdfBuffer);
      
      expect(analysis.hasText).toBe(true);
      expect(analysis.textLength).toBeGreaterThan(0);
      expect(analysis.isImageBased).toBe(false);
      expect(analysis.recommendedFormat).toBe('PDF');
      expect(analysis.estimatedPages).toBeGreaterThan(0);
    });

    it('should detect image-based PDF', async () => {
      const imageBasedBuffer = Buffer.from('%PDF-1.4\\nVery short text');
      const analysis = await analyzePDF(imageBasedBuffer);
      
      expect(analysis.hasText).toBe(true);
      expect(analysis.textLength).toBeLessThan(100);
      expect(analysis.isImageBased).toBe(true);
      expect(analysis.recommendedFormat).toBe('CSV or Excel');
    });

    it('should handle PDF analysis errors', async () => {
      const invalidBuffer = Buffer.from('Invalid PDF');
      const analysis = await analyzePDF(invalidBuffer);
      
      expect(analysis.hasText).toBe(false);
      expect(analysis.isImageBased).toBe(true);
      expect(analysis.error).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty PDF buffer', async () => {
      const emptyBuffer = Buffer.alloc(0);
      const result = await parsePDF(emptyBuffer);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('PDF parsing failed');
    });

    it('should handle PDF with special characters', async () => {
      const specialCharsBuffer = Buffer.from('%PDF-1.4\\nSKU          Description              Unit Price  Currency  MOQ  UOM\\nPRÖD-001     Wìdget Ä                 10.50       EUR       1    EA\\n');
      const result = await parsePDF(specialCharsBuffer);
      
      expect(result.success).toBe(true);
      expect(result.data[0].sku).toBe('PRÖD-001');
      expect(result.data[0].description).toBe('Wìdget Ä');
      expect(result.data[0].currency).toBe('EUR');
    });

    it('should handle large PDF files efficiently', async () => {
      // Create a large mock PDF
      let largePdfContent = '%PDF-1.4\\nSKU          Description              Unit Price  Currency  MOQ  UOM\\n';
      for (let i = 1; i <= 1000; i++) {
        largePdfContent += `PROD-${i.toString().padStart(3, '0')}     Widget ${i}                  ${(10 + i * 0.5).toFixed(2)}       USD       1    EA\\n`;
      }
      
      const largeBuffer = Buffer.from(largePdfContent);
      const startTime = Date.now();
      const result = await parsePDF(largeBuffer);
      const endTime = Date.now();
      
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1000);
      expect(endTime - startTime).toBeLessThan(10000); // Should complete within 10 seconds
    });

    it('should handle tier pricing in various formats', async () => {
      const tierBuffer = Buffer.from('%PDF-1.4\\nSKU          Description              Unit Price  Currency  MOQ  UOM\\nPROD-001     Widget A                 10.50       USD       1    EA\\n\\nTier Pricing:\\nPROD-001: 10+ units = $9.50\\nPROD-001: 50+ units = $8.75\\nPROD-001: 100+ units = $8.00');
      const result = await parsePDF(tierBuffer);
      
      expect(result.success).toBe(true);
      expect(result.data[0].tierPricing).toEqual([
        { minQuantity: 10, price: 9.50 },
        { minQuantity: 50, price: 8.75 },
        { minQuantity: 100, price: 8.00 }
      ]);
    });
  });
});