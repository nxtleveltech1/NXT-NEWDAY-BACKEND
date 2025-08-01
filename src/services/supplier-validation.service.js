/**
 * Supplier Validation Service
 * Handles comprehensive validation for supplier price list data:
 * - Business rule validation
 * - Data integrity checks
 * - Price validation
 * - SKU format validation
 * - Supplier-specific validation rules
 */

export class SupplierValidationService {
  constructor() {
    this.validationRules = {
      required: ['sku', 'unitPrice'],
      priceRange: { min: 0.01, max: 999999.99 },
      skuPattern: /^[A-Z0-9\-_]+$/i,
      descriptionMaxLength: 500
    };
  }

  /**
   * Validate price list data
   */
  async validatePriceListData(data, options = {}) {
    const { supplierId, strictMode = false, maxErrors = 50 } = options;
    
    const validData = [];
    const criticalErrors = [];
    const warnings = [];

    for (let i = 0; i < data.length && criticalErrors.length < maxErrors; i++) {
      const item = data[i];
      const itemValidation = this.validateItem(item, i + 1, strictMode);
      
      if (itemValidation.isValid) {
        validData.push(itemValidation.normalizedItem);
      } else {
        criticalErrors.push(...itemValidation.errors);
      }
      
      warnings.push(...itemValidation.warnings);
    }

    return {
      validData,
      criticalErrors,
      warnings,
      summary: {
        totalItems: data.length,
        validItems: validData.length,
        errorCount: criticalErrors.length,
        warningCount: warnings.length
      }
    };
  }

  /**
   * Validate individual item
   */
  validateItem(item, rowNumber, strictMode) {
    const errors = [];
    const warnings = [];
    let normalizedItem = { ...item };

    // Required field validation
    for (const field of this.validationRules.required) {
      if (!item[field] || item[field] === '') {
        errors.push(`Row ${rowNumber}: ${field} is required`);
      }
    }

    // Price validation
    if (item.unitPrice !== undefined) {
      const price = parseFloat(item.unitPrice);
      if (isNaN(price)) {
        errors.push(`Row ${rowNumber}: Invalid price format`);
      } else if (price < this.validationRules.priceRange.min) {
        errors.push(`Row ${rowNumber}: Price too low (minimum ${this.validationRules.priceRange.min})`);
      } else if (price > this.validationRules.priceRange.max) {
        warnings.push(`Row ${rowNumber}: Price very high (${price})`);
      }
      normalizedItem.unitPrice = price;
    }

    // SKU validation
    if (item.sku && !this.validationRules.skuPattern.test(item.sku)) {
      if (strictMode) {
        errors.push(`Row ${rowNumber}: Invalid SKU format`);
      } else {
        warnings.push(`Row ${rowNumber}: SKU format may cause issues`);
      }
    }

    // Description length validation
    if (item.description && item.description.length > this.validationRules.descriptionMaxLength) {
      if (strictMode) {
        errors.push(`Row ${rowNumber}: Description too long`);
      } else {
        warnings.push(`Row ${rowNumber}: Description will be truncated`);
        normalizedItem.description = item.description.substring(0, this.validationRules.descriptionMaxLength);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      normalizedItem
    };
  }
}

export const supplierValidationService = new SupplierValidationService();
export default supplierValidationService;