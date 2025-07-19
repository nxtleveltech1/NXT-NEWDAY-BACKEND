import { describe, it, expect, beforeEach } from '@jest/globals';
import { validatePriceListData, BUSINESS_RULES, SUPPORTED_UOM } from '../validation.js';

describe('Enhanced Validation', () => {
  let samplePriceList;
  let sampleItems;

  beforeEach(() => {
    samplePriceList = {
      supplierId: 123,
      uploadedBy: 456,
      name: 'Test Price List',
      effectiveDate: new Date(Date.now() + 24 * 60 * 60 * 1000) // Tomorrow
    };

    sampleItems = [
      {
        sku: 'PROD-001',
        description: 'High-quality widget',
        unitPrice: 10.50,
        currency: 'USD',
        minimumOrderQuantity: 1,
        unitOfMeasure: 'EA',
        tierPricing: [
          { minQuantity: 10, price: 9.50 },
          { minQuantity: 50, price: 8.75 }
        ]
      },
      {
        sku: 'PROD-002',
        description: 'Premium widget',
        unitPrice: 25.00,
        currency: 'USD',
        minimumOrderQuantity: 5,
        unitOfMeasure: 'BOX'
      }
    ];
  });

  describe('Price List Metadata Validation', () => {
    it('should validate complete price list metadata', () => {
      const result = validatePriceListData(samplePriceList, sampleItems);
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.summary.totalItems).toBe(2);
    });

    it('should require supplier ID', () => {
      delete samplePriceList.supplierId;
      const result = validatePriceListData(samplePriceList, sampleItems);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'supplierId',
          error: 'Supplier ID is required'
        })
      );
    });

    it('should require uploaded by user ID', () => {
      delete samplePriceList.uploadedBy;
      const result = validatePriceListData(samplePriceList, sampleItems);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'uploadedBy',
          error: 'Uploaded by user ID is required'
        })
      );
    });

    it('should warn about past effective dates', () => {
      samplePriceList.effectiveDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // Yesterday
      const result = validatePriceListData(samplePriceList, sampleItems);
      
      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          field: 'effectiveDate',
          message: 'Effective date is in the past'
        })
      );
    });

    it('should handle strict mode for price list name', () => {
      delete samplePriceList.name;
      
      // Non-strict mode: warning
      const normalResult = validatePriceListData(samplePriceList, sampleItems, { strictMode: false });
      expect(normalResult.valid).toBe(true);
      expect(normalResult.warnings).toContainEqual(
        expect.objectContaining({
          field: 'name',
          message: 'Price list name is recommended for better organization'
        })
      );
      
      // Strict mode: error
      const strictResult = validatePriceListData(samplePriceList, sampleItems, { strictMode: true });
      expect(strictResult.valid).toBe(false);
      expect(strictResult.errors).toContainEqual(
        expect.objectContaining({
          field: 'name',
          error: 'Price list name is required'
        })
      );
    });
  });

  describe('Performance Validation', () => {
    it('should handle large uploads with warnings', () => {
      const largeItems = Array.from({ length: 1500 }, (_, i) => ({
        sku: `PROD-${i.toString().padStart(4, '0')}`,
        description: `Product ${i}`,
        unitPrice: 10.00 + i,
        currency: 'USD',
        minimumOrderQuantity: 1,
        unitOfMeasure: 'EA'
      }));
      
      const result = validatePriceListData(samplePriceList, largeItems);
      
      expect(result.valid).toBe(true);
      expect(result.performance).toContainEqual(
        expect.objectContaining({
          field: 'itemCount',
          message: expect.stringContaining('Large upload detected')
        })
      );
    });

    it('should reject extremely large uploads', () => {
      const extremeItems = Array.from({ length: 15000 }, (_, i) => ({
        sku: `PROD-${i}`,
        description: `Product ${i}`,
        unitPrice: 10.00,
        currency: 'USD'
      }));
      
      const result = validatePriceListData(samplePriceList, extremeItems);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'itemCount',
          error: expect.stringContaining('Too many items')
        })
      );
    });
  });

  describe('SKU Validation', () => {
    it('should validate proper SKU format', () => {
      const result = validatePriceListData(samplePriceList, sampleItems);
      expect(result.valid).toBe(true);
    });

    it('should reject empty SKUs', () => {
      sampleItems[0].sku = '';
      const result = validatePriceListData(samplePriceList, sampleItems);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          row: 1,
          field: 'sku',
          error: 'SKU is required'
        })
      );
    });

    it('should reject SKUs that are too short', () => {
      sampleItems[0].sku = 'AB';
      const result = validatePriceListData(samplePriceList, sampleItems);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          row: 1,
          field: 'sku',
          error: `SKU too short. Minimum length: ${BUSINESS_RULES.sku.minLength}`
        })
      );
    });

    it('should reject SKUs that are too long', () => {
      sampleItems[0].sku = 'A'.repeat(60);
      const result = validatePriceListData(samplePriceList, sampleItems);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          row: 1,
          field: 'sku',
          error: `SKU too long. Maximum length: ${BUSINESS_RULES.sku.maxLength}`
        })
      );
    });

    it('should warn about special characters in SKU', () => {
      sampleItems[0].sku = 'PROD@001#';
      const result = validatePriceListData(samplePriceList, sampleItems);
      
      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          row: 1,
          field: 'sku',
          message: 'SKU contains special characters. Recommended format: alphanumeric with hyphens/underscores only'
        })
      );
    });

    it('should warn about reserved prefixes', () => {
      sampleItems[0].sku = 'SYS-001';
      const result = validatePriceListData(samplePriceList, sampleItems);
      
      expect(result.valid).toBe(true);
      expect(result.businessWarnings).toContainEqual(
        expect.objectContaining({
          row: 1,
          field: 'sku',
          message: 'SKU uses reserved prefix. Consider using a different naming convention.'
        })
      );
    });

    it('should detect duplicate SKUs', () => {
      sampleItems[1].sku = sampleItems[0].sku;
      const result = validatePriceListData(samplePriceList, sampleItems);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'sku',
          error: expect.stringContaining('Duplicate SKUs found'),
          affectedItems: 1
        })
      );
    });
  });

  describe('Price Validation', () => {
    it('should validate reasonable prices', () => {
      const result = validatePriceListData(samplePriceList, sampleItems);
      expect(result.valid).toBe(true);
    });

    it('should reject zero or negative prices', () => {
      sampleItems[0].unitPrice = 0;
      const result = validatePriceListData(samplePriceList, sampleItems);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          row: 1,
          field: 'unitPrice',
          error: 'Valid unit price is required and must be greater than 0'
        })
      );
    });

    it('should warn about very low prices', () => {
      sampleItems[0].unitPrice = 0.005;
      const result = validatePriceListData(samplePriceList, sampleItems);
      
      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          row: 1,
          field: 'unitPrice',
          message: expect.stringContaining('Unit price is very low')
        })
      );
    });

    it('should warn about very high prices', () => {
      sampleItems[0].unitPrice = 1500000;
      const result = validatePriceListData(samplePriceList, sampleItems);
      
      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          row: 1,
          field: 'unitPrice',
          message: expect.stringContaining('Unit price is very high')
        })
      );
    });

    it('should suggest psychological pricing', () => {
      sampleItems[0].unitPrice = 100;
      const result = validatePriceListData(samplePriceList, sampleItems);
      
      expect(result.valid).toBe(true);
      expect(result.businessWarnings).toContainEqual(
        expect.objectContaining({
          row: 1,
          field: 'unitPrice',
          message: 'Round number pricing detected. Consider psychological pricing strategies.'
        })
      );
    });
  });

  describe('Currency Validation', () => {
    it('should accept supported currencies', () => {
      sampleItems[0].currency = 'EUR';
      const result = validatePriceListData(samplePriceList, sampleItems);
      expect(result.valid).toBe(true);
    });

    it('should handle unsupported currencies in strict mode', () => {
      sampleItems[0].currency = 'JPY';
      
      // Non-strict mode: warning
      const normalResult = validatePriceListData(samplePriceList, sampleItems, { strictMode: false });
      expect(normalResult.valid).toBe(true);
      expect(normalResult.warnings).toContainEqual(
        expect.objectContaining({
          row: 1,
          field: 'currency',
          message: expect.stringContaining('Currency JPY is not in the standard list')
        })
      );
      
      // Strict mode: error
      const strictResult = validatePriceListData(samplePriceList, sampleItems, { strictMode: true });
      expect(strictResult.valid).toBe(false);
      expect(strictResult.errors).toContainEqual(
        expect.objectContaining({
          row: 1,
          field: 'currency',
          error: expect.stringContaining('Unsupported currency: JPY')
        })
      );
    });
  });

  describe('Description Validation', () => {
    it('should accept reasonable descriptions', () => {
      const result = validatePriceListData(samplePriceList, sampleItems);
      expect(result.valid).toBe(true);
    });

    it('should warn about very short descriptions', () => {
      sampleItems[0].description = 'A';
      const result = validatePriceListData(samplePriceList, sampleItems);
      
      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          row: 1,
          field: 'description',
          message: 'Description is very short. Consider adding more detail.'
        })
      );
    });

    it('should warn about very long descriptions', () => {
      sampleItems[0].description = 'A'.repeat(600);
      const result = validatePriceListData(samplePriceList, sampleItems);
      
      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          row: 1,
          field: 'description',
          message: expect.stringContaining('Description is too long')
        })
      );
    });

    it('should warn about placeholder words', () => {
      sampleItems[0].description = 'This is a test product';
      const result = validatePriceListData(samplePriceList, sampleItems);
      
      expect(result.valid).toBe(true);
      expect(result.businessWarnings).toContainEqual(
        expect.objectContaining({
          row: 1,
          field: 'description',
          message: expect.stringContaining('Description contains placeholder words: test')
        })
      );
    });
  });

  describe('Tier Pricing Validation', () => {
    it('should validate proper tier pricing', () => {
      const result = validatePriceListData(samplePriceList, sampleItems);
      expect(result.valid).toBe(true);
    });

    it('should reject invalid tier quantities', () => {
      sampleItems[0].tierPricing[0].minQuantity = 0;
      const result = validatePriceListData(samplePriceList, sampleItems);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          row: 1,
          field: 'tierPricing',
          error: 'Tier 1: Invalid minimum quantity'
        })
      );
    });

    it('should reject invalid tier prices', () => {
      sampleItems[0].tierPricing[0].price = 0;
      const result = validatePriceListData(samplePriceList, sampleItems);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          row: 1,
          field: 'tierPricing',
          error: 'Tier 1: Invalid price'
        })
      );
    });

    it('should warn when tier prices are not lower than unit price', () => {
      sampleItems[0].tierPricing[0].price = 12.00; // Higher than unit price
      const result = validatePriceListData(samplePriceList, sampleItems);
      
      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          row: 1,
          field: 'tierPricing',
          message: expect.stringContaining('Price ($12) is not lower than unit price')
        })
      );
    });

    it('should warn about small discounts', () => {
      sampleItems[0].tierPricing[0].price = 10.40; // Only 1% discount
      const result = validatePriceListData(samplePriceList, sampleItems);
      
      expect(result.valid).toBe(true);
      expect(result.businessWarnings).toContainEqual(
        expect.objectContaining({
          row: 1,
          field: 'tierPricing',
          message: expect.stringContaining('Small discount (1.0%)')
        })
      );
    });

    it('should warn about too many tier levels', () => {
      sampleItems[0].tierPricing = Array.from({ length: 15 }, (_, i) => ({
        minQuantity: (i + 1) * 10,
        price: 10.50 - (i + 1) * 0.1
      }));
      
      const result = validatePriceListData(samplePriceList, sampleItems);
      
      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          row: 1,
          field: 'tierPricing',
          message: expect.stringContaining('Too many tier pricing levels')
        })
      );
    });

    it('should warn about small quantity gaps', () => {
      sampleItems[0].tierPricing = [
        { minQuantity: 10, price: 9.50 },
        { minQuantity: 12, price: 9.40 } // Only 2 unit gap
      ];
      
      const result = validatePriceListData(samplePriceList, sampleItems);
      
      expect(result.valid).toBe(true);
      expect(result.businessWarnings).toContainEqual(
        expect.objectContaining({
          row: 1,
          field: 'tierPricing',
          message: expect.stringContaining('Small quantity gap between tiers (2)')
        })
      );
    });
  });

  describe('Unit of Measure Validation', () => {
    it('should accept standard units of measure', () => {
      sampleItems[0].unitOfMeasure = 'KG';
      const result = validatePriceListData(samplePriceList, sampleItems);
      expect(result.valid).toBe(true);
    });

    it('should warn about non-standard units of measure', () => {
      sampleItems[0].unitOfMeasure = 'CUSTOM_UNIT';
      const result = validatePriceListData(samplePriceList, sampleItems);
      
      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          row: 1,
          field: 'unitOfMeasure',
          message: expect.stringContaining('Unit of measure \\'CUSTOM_UNIT\\' is not in the standard list')
        })
      );
    });
  });

  describe('Summary and Recommendations', () => {
    it('should generate comprehensive summary', () => {
      const result = validatePriceListData(samplePriceList, sampleItems);
      
      expect(result.summary).toEqual({
        totalItems: 2,
        uniqueSkus: 2,
        duplicateSkus: 0,
        currencies: ['USD'],
        itemsWithTierPricing: 1,
        totalErrors: 0,
        totalWarnings: 0,
        processingRecommendation: 'PROCEED',
        estimatedProcessingTime: expect.any(String)
      });
    });

    it('should provide actionable recommendations', () => {
      // Add some warnings
      sampleItems[0].description = 'test';
      sampleItems[1].unitPrice = 0.005;
      
      const result = validatePriceListData(samplePriceList, sampleItems);
      
      expect(result.recommendations).toContainEqual(
        expect.objectContaining({
          type: 'business',
          priority: 'low',
          message: expect.stringContaining('business suggestion(s)')
        })
      );
    });

    it('should warn about multiple currencies', () => {
      sampleItems[1].currency = 'EUR';
      const result = validatePriceListData(samplePriceList, sampleItems);
      
      expect(result.recommendations).toContainEqual(
        expect.objectContaining({
          type: 'business',
          message: expect.stringContaining('Multiple currencies detected (USD, EUR)')
        })
      );
    });
  });

  describe('Validation Options', () => {
    it('should respect checkDuplicates option', () => {
      sampleItems[1].sku = sampleItems[0].sku;
      
      // With duplicate checking (default)
      const withCheck = validatePriceListData(samplePriceList, sampleItems, { checkDuplicates: true });
      expect(withCheck.valid).toBe(false);
      
      // Without duplicate checking
      const withoutCheck = validatePriceListData(samplePriceList, sampleItems, { checkDuplicates: false });
      expect(withoutCheck.valid).toBe(true);
    });

    it('should respect validateBusinessRules option', () => {
      sampleItems[0].sku = 'SYS-001'; // Reserved prefix
      
      // With business rules (default)
      const withRules = validatePriceListData(samplePriceList, sampleItems, { validateBusinessRules: true });
      expect(withRules.businessWarnings.length).toBeGreaterThan(0);
      
      // Without business rules
      const withoutRules = validatePriceListData(samplePriceList, sampleItems, { validateBusinessRules: false });
      expect(withoutRules.businessWarnings).toHaveLength(0);
    });

    it('should respect performanceCheck option', () => {
      const largeItems = Array.from({ length: 1500 }, (_, i) => ({
        sku: `PROD-${i}`,
        description: `Product ${i}`,
        unitPrice: 10.00,
        currency: 'USD'
      }));
      
      // With performance check (default)
      const withCheck = validatePriceListData(samplePriceList, largeItems, { performanceCheck: true });
      expect(withCheck.performance.length).toBeGreaterThan(0);
      
      // Without performance check
      const withoutCheck = validatePriceListData(samplePriceList, largeItems, { performanceCheck: false });
      expect(withoutCheck.performance).toHaveLength(0);
    });
  });
});