// Enhanced validation module for price list parsers
// Implements business rule validation and comprehensive error reporting

// Business configuration
const BUSINESS_RULES = {
  currencies: {
    supported: ['USD', 'EUR', 'GBP', 'ZAR'],
    default: 'USD'
  },
  pricing: {
    minUnitPrice: 0.01,
    maxUnitPrice: 999999.99,
    maxTierPricingLevels: 10,
    tierDiscountThreshold: 0.05 // Minimum 5% discount for tier pricing
  },
  sku: {
    minLength: 3,
    maxLength: 50,
    pattern: /^[A-Z0-9-_]+$/i,
    reservedPrefixes: ['SYS-', 'TEMP-', 'TEST-'] // Prefixes to warn about
  },
  quantities: {
    minOrderQuantity: 1,
    maxOrderQuantity: 999999,
    tierQuantityIncrement: 5 // Minimum increment between tier levels
  },
  description: {
    maxLength: 500,
    minLength: 3,
    forbiddenWords: ['test', 'sample', 'dummy', 'placeholder']
  },
  performance: {
    maxItemsPerUpload: 10000,
    warningThreshold: 1000
  }
};

// Supported units of measure
const SUPPORTED_UOM = [
  'EA', 'EACH', 'PCS', 'PIECE', 'BOX', 'CASE', 'PKG', 'PACK',
  'LB', 'KG', 'OZ', 'G', 'TON', 'MT',
  'FT', 'M', 'IN', 'CM', 'YD', 'MM',
  'GAL', 'L', 'QT', 'ML', 'FL OZ',
  'SQ FT', 'SQ M', 'SQ IN', 'SQ CM'
];

// Enhanced validation function for price list data
export function validatePriceListData(priceList, items, options = {}) {
  const {
    strictMode = false,
    checkDuplicates = true,
    validateBusinessRules = true,
    performanceCheck = true
  } = options;

  const errors = [];
  const warnings = [];
  const businessWarnings = [];
  const performance = [];

  // Validate price list metadata
  const priceListValidation = validatePriceListMetadata(priceList, strictMode);
  errors.push(...priceListValidation.errors);
  warnings.push(...priceListValidation.warnings);

  // Performance check
  if (performanceCheck) {
    const perfCheck = validatePerformance(items);
    performance.push(...perfCheck.warnings);
    errors.push(...perfCheck.errors);
  }

  // Validate items
  const itemValidation = validateItems(items, {
    strictMode,
    checkDuplicates,
    validateBusinessRules
  });
  
  errors.push(...itemValidation.errors);
  warnings.push(...itemValidation.warnings);
  businessWarnings.push(...itemValidation.businessWarnings);

  // Generate validation summary
  const summary = generateValidationSummary(items, errors, warnings);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    businessWarnings,
    performance,
    summary,
    recommendations: generateRecommendations(errors, warnings, businessWarnings, items)
  };
}

// Validate price list metadata
function validatePriceListMetadata(priceList, strictMode = false) {
  const errors = [];
  const warnings = [];

  if (!priceList.supplierId) {
    errors.push({
      field: 'supplierId',
      error: 'Supplier ID is required',
      severity: 'error'
    });
  }

  if (!priceList.uploadedBy) {
    errors.push({
      field: 'uploadedBy',
      error: 'Uploaded by user ID is required',
      severity: 'error'
    });
  }

  if (!priceList.name || priceList.name.trim().length === 0) {
    if (strictMode) {
      errors.push({
        field: 'name',
        error: 'Price list name is required',
        severity: 'error'
      });
    } else {
      warnings.push({
        field: 'name',
        message: 'Price list name is recommended for better organization',
        severity: 'warning'
      });
    }
  }

  if (priceList.effectiveDate) {
    const effectiveDate = new Date(priceList.effectiveDate);
    const now = new Date();
    
    if (effectiveDate < now.setHours(0, 0, 0, 0)) {
      warnings.push({
        field: 'effectiveDate',
        message: 'Effective date is in the past',
        severity: 'warning'
      });
    }
  }

  return { errors, warnings };
}

// Validate performance aspects
function validatePerformance(items) {
  const errors = [];
  const warnings = [];

  if (items.length > BUSINESS_RULES.performance.maxItemsPerUpload) {
    errors.push({
      field: 'itemCount',
      error: `Too many items (${items.length}). Maximum allowed: ${BUSINESS_RULES.performance.maxItemsPerUpload}`,
      severity: 'error'
    });
  } else if (items.length > BUSINESS_RULES.performance.warningThreshold) {
    warnings.push({
      field: 'itemCount',
      message: `Large upload detected (${items.length} items). Processing may take longer than usual.`,
      severity: 'warning',
      suggestion: 'Consider splitting into smaller batches for faster processing'
    });
  }

  return { errors, warnings };
}

// Validate individual items
function validateItems(items, options = {}) {
  const { strictMode = false, checkDuplicates = true, validateBusinessRules = true } = options;
  const errors = [];
  const warnings = [];
  const businessWarnings = [];

  // Track duplicates
  const skuMap = new Map();
  const duplicateSkus = new Set();

  items.forEach((item, index) => {
    const rowNumber = index + 1;
    
    // Check for duplicate SKUs
    if (checkDuplicates) {
      if (skuMap.has(item.sku)) {
        duplicateSkus.add(item.sku);
      }
      skuMap.set(item.sku, rowNumber);
    }

    // Validate required fields
    const itemValidation = validateSingleItem(item, rowNumber, strictMode, validateBusinessRules);
    errors.push(...itemValidation.errors);
    warnings.push(...itemValidation.warnings);
    businessWarnings.push(...itemValidation.businessWarnings);
  });

  // Report duplicate SKUs
  if (duplicateSkus.size > 0) {
    errors.push({
      field: 'sku',
      error: `Duplicate SKUs found: ${Array.from(duplicateSkus).join(', ')}`,
      severity: 'error',
      affectedItems: duplicateSkus.size
    });
  }

  return { errors, warnings, businessWarnings };
}

// Validate a single item
function validateSingleItem(item, rowNumber, strictMode = false, validateBusinessRules = true) {
  const errors = [];
  const warnings = [];
  const businessWarnings = [];

  // SKU validation
  if (!item.sku || item.sku.trim().length === 0) {
    errors.push({
      row: rowNumber,
      field: 'sku',
      error: 'SKU is required',
      severity: 'error',
      data: item
    });
  } else {
    const skuValidation = validateSKU(item.sku, validateBusinessRules);
    errors.push(...skuValidation.errors.map(e => ({ ...e, row: rowNumber })));
    warnings.push(...skuValidation.warnings.map(w => ({ ...w, row: rowNumber })));
    businessWarnings.push(...skuValidation.businessWarnings.map(bw => ({ ...bw, row: rowNumber })));
  }

  // Unit price validation
  if (!item.unitPrice || isNaN(item.unitPrice) || item.unitPrice <= 0) {
    errors.push({
      row: rowNumber,
      field: 'unitPrice',
      error: 'Valid unit price is required and must be greater than 0',
      severity: 'error',
      data: item
    });
  } else if (validateBusinessRules) {
    const priceValidation = validatePrice(item.unitPrice);
    warnings.push(...priceValidation.warnings.map(w => ({ ...w, row: rowNumber })));
    businessWarnings.push(...priceValidation.businessWarnings.map(bw => ({ ...bw, row: rowNumber })));
  }

  // Currency validation
  if (item.currency && !BUSINESS_RULES.currencies.supported.includes(item.currency.toUpperCase())) {
    if (strictMode) {
      errors.push({
        row: rowNumber,
        field: 'currency',
        error: `Unsupported currency: ${item.currency}. Supported: ${BUSINESS_RULES.currencies.supported.join(', ')}`,
        severity: 'error',
        data: item
      });
    } else {
      warnings.push({
        row: rowNumber,
        field: 'currency',
        message: `Currency ${item.currency} is not in the standard list. Proceeding with caution.`,
        severity: 'warning'
      });
    }
  }

  // Description validation
  if (validateBusinessRules && item.description) {
    const descValidation = validateDescription(item.description);
    warnings.push(...descValidation.warnings.map(w => ({ ...w, row: rowNumber })));
    businessWarnings.push(...descValidation.businessWarnings.map(bw => ({ ...bw, row: rowNumber })));
  }

  // Minimum order quantity validation
  if (item.minimumOrderQuantity && (isNaN(item.minimumOrderQuantity) || item.minimumOrderQuantity < BUSINESS_RULES.quantities.minOrderQuantity)) {
    errors.push({
      row: rowNumber,
      field: 'minimumOrderQuantity',
      error: `Invalid minimum order quantity. Must be at least ${BUSINESS_RULES.quantities.minOrderQuantity}`,
      severity: 'error',
      data: item
    });
  }

  // Unit of measure validation
  if (item.unitOfMeasure && !SUPPORTED_UOM.includes(item.unitOfMeasure.toUpperCase())) {
    warnings.push({
      row: rowNumber,
      field: 'unitOfMeasure',
      message: `Unit of measure '${item.unitOfMeasure}' is not in the standard list`,
      severity: 'warning',
      suggestion: `Consider using one of: ${SUPPORTED_UOM.slice(0, 10).join(', ')}`
    });
  }

  // Tier pricing validation
  if (item.tierPricing && item.tierPricing.length > 0) {
    const tierValidation = validateTierPricing(item.tierPricing, item.unitPrice);
    errors.push(...tierValidation.errors.map(e => ({ ...e, row: rowNumber })));
    warnings.push(...tierValidation.warnings.map(w => ({ ...w, row: rowNumber })));
    businessWarnings.push(...tierValidation.businessWarnings.map(bw => ({ ...bw, row: rowNumber })));
  }

  return { errors, warnings, businessWarnings };
}

// Validate SKU format and business rules
function validateSKU(sku, validateBusinessRules = true) {
  const errors = [];
  const warnings = [];
  const businessWarnings = [];

  if (sku.length < BUSINESS_RULES.sku.minLength) {
    errors.push({
      field: 'sku',
      error: `SKU too short. Minimum length: ${BUSINESS_RULES.sku.minLength}`,
      severity: 'error'
    });
  }

  if (sku.length > BUSINESS_RULES.sku.maxLength) {
    errors.push({
      field: 'sku',
      error: `SKU too long. Maximum length: ${BUSINESS_RULES.sku.maxLength}`,
      severity: 'error'
    });
  }

  if (!BUSINESS_RULES.sku.pattern.test(sku)) {
    warnings.push({
      field: 'sku',
      message: 'SKU contains special characters. Recommended format: alphanumeric with hyphens/underscores only',
      severity: 'warning'
    });
  }

  if (validateBusinessRules) {
    // Check for reserved prefixes
    const hasReservedPrefix = BUSINESS_RULES.sku.reservedPrefixes.some(prefix => 
      sku.toUpperCase().startsWith(prefix)
    );
    
    if (hasReservedPrefix) {
      businessWarnings.push({
        field: 'sku',
        message: `SKU uses reserved prefix. Consider using a different naming convention.`,
        severity: 'business_warning'
      });
    }
  }

  return { errors, warnings, businessWarnings };
}

// Validate price business rules
function validatePrice(price) {
  const warnings = [];
  const businessWarnings = [];

  if (price < BUSINESS_RULES.pricing.minUnitPrice) {
    warnings.push({
      field: 'unitPrice',
      message: `Unit price is very low ($${price}). Please verify accuracy.`,
      severity: 'warning'
    });
  }

  if (price > BUSINESS_RULES.pricing.maxUnitPrice) {
    warnings.push({
      field: 'unitPrice',
      message: `Unit price is very high ($${price}). Please verify accuracy.`,
      severity: 'warning'
    });
  }

  // Check for common pricing patterns
  if (price % 1 === 0 && price > 10) {
    businessWarnings.push({
      field: 'unitPrice',
      message: 'Round number pricing detected. Consider psychological pricing strategies.',
      severity: 'business_suggestion'
    });
  }

  return { warnings, businessWarnings };
}

// Validate description content
function validateDescription(description) {
  const warnings = [];
  const businessWarnings = [];

  if (description.length < BUSINESS_RULES.description.minLength) {
    warnings.push({
      field: 'description',
      message: 'Description is very short. Consider adding more detail.',
      severity: 'warning'
    });
  }

  if (description.length > BUSINESS_RULES.description.maxLength) {
    warnings.push({
      field: 'description',
      message: `Description is too long (${description.length} chars). Maximum: ${BUSINESS_RULES.description.maxLength}`,
      severity: 'warning'
    });
  }

  // Check for forbidden words
  const lowerDesc = description.toLowerCase();
  const forbiddenFound = BUSINESS_RULES.description.forbiddenWords.filter(word => 
    lowerDesc.includes(word)
  );

  if (forbiddenFound.length > 0) {
    businessWarnings.push({
      field: 'description',
      message: `Description contains placeholder words: ${forbiddenFound.join(', ')}`,
      severity: 'business_warning'
    });
  }

  return { warnings, businessWarnings };
}

// Validate tier pricing structure and business logic
function validateTierPricing(tierPricing, unitPrice) {
  const errors = [];
  const warnings = [];
  const businessWarnings = [];

  if (tierPricing.length > BUSINESS_RULES.pricing.maxTierPricingLevels) {
    warnings.push({
      field: 'tierPricing',
      message: `Too many tier pricing levels (${tierPricing.length}). Recommended maximum: ${BUSINESS_RULES.pricing.maxTierPricingLevels}`,
      severity: 'warning'
    });
  }

  // Validate each tier
  tierPricing.forEach((tier, index) => {
    if (!tier.minQuantity || tier.minQuantity <= 0) {
      errors.push({
        field: 'tierPricing',
        error: `Tier ${index + 1}: Invalid minimum quantity`,
        severity: 'error'
      });
    }

    if (!tier.price || tier.price <= 0) {
      errors.push({
        field: 'tierPricing',
        error: `Tier ${index + 1}: Invalid price`,
        severity: 'error'
      });
    }

    // Business rule: tier price should be lower than unit price
    if (tier.price >= unitPrice) {
      warnings.push({
        field: 'tierPricing',
        message: `Tier ${index + 1}: Price ($${tier.price}) is not lower than unit price ($${unitPrice})`,
        severity: 'warning'
      });
    }

    // Business rule: sufficient discount
    const discountPercent = ((unitPrice - tier.price) / unitPrice) * 100;
    if (discountPercent < BUSINESS_RULES.pricing.tierDiscountThreshold * 100) {
      businessWarnings.push({
        field: 'tierPricing',
        message: `Tier ${index + 1}: Small discount (${discountPercent.toFixed(1)}%). Consider larger volume discounts.`,
        severity: 'business_suggestion'
      });
    }
  });

  // Check tier progression
  const sortedTiers = [...tierPricing].sort((a, b) => a.minQuantity - b.minQuantity);
  for (let i = 1; i < sortedTiers.length; i++) {
    const currentTier = sortedTiers[i];
    const previousTier = sortedTiers[i - 1];

    // Quantities should increase
    if (currentTier.minQuantity <= previousTier.minQuantity) {
      errors.push({
        field: 'tierPricing',
        error: `Tier quantity overlap or incorrect order`,
        severity: 'error'
      });
    }

    // Prices should decrease
    if (currentTier.price >= previousTier.price) {
      warnings.push({
        field: 'tierPricing',
        message: 'Tier prices should decrease with higher quantities',
        severity: 'warning'
      });
    }

    // Check for reasonable quantity increments
    const quantityGap = currentTier.minQuantity - previousTier.minQuantity;
    if (quantityGap < BUSINESS_RULES.quantities.tierQuantityIncrement) {
      businessWarnings.push({
        field: 'tierPricing',
        message: `Small quantity gap between tiers (${quantityGap}). Consider larger increments.`,
        severity: 'business_suggestion'
      });
    }
  }

  return { errors, warnings, businessWarnings };
}

// Generate validation summary
function generateValidationSummary(items, errors, warnings) {
  const skuSet = new Set(items.map(item => item.sku).filter(sku => sku));
  const currencySet = new Set(items.map(item => item.currency).filter(curr => curr));
  const itemsWithTierPricing = items.filter(item => item.tierPricing && item.tierPricing.length > 0);

  return {
    totalItems: items.length,
    uniqueSkus: skuSet.size,
    duplicateSkus: items.length - skuSet.size,
    currencies: Array.from(currencySet),
    itemsWithTierPricing: itemsWithTierPricing.length,
    totalErrors: errors.length,
    totalWarnings: warnings.length,
    processingRecommendation: errors.length === 0 ? 'PROCEED' : 'FIX_ERRORS',
    estimatedProcessingTime: calculateProcessingTime(items.length)
  };
}

// Generate recommendations based on validation results
function generateRecommendations(errors, warnings, businessWarnings, items) {
  const recommendations = [];

  if (errors.length > 0) {
    recommendations.push({
      type: 'error',
      priority: 'high',
      message: `Fix ${errors.length} error(s) before proceeding with upload`,
      action: 'required'
    });
  }

  if (warnings.length > items.length * 0.1) { // More than 10% warnings
    recommendations.push({
      type: 'warning',
      priority: 'medium',
      message: `High number of warnings (${warnings.length}). Review data quality.`,
      action: 'recommended'
    });
  }

  if (businessWarnings.length > 0) {
    recommendations.push({
      type: 'business',
      priority: 'low',
      message: `Consider ${businessWarnings.length} business suggestion(s) for optimization`,
      action: 'optional'
    });
  }

  if (items.length > BUSINESS_RULES.performance.warningThreshold) {
    recommendations.push({
      type: 'performance',
      priority: 'medium',
      message: 'Large upload detected. Consider processing during off-peak hours.',
      action: 'recommended'
    });
  }

  // Add format-specific recommendations
  const currencies = new Set(items.map(item => item.currency).filter(curr => curr));
  if (currencies.size > 1) {
    recommendations.push({
      type: 'business',
      priority: 'medium',
      message: `Multiple currencies detected (${Array.from(currencies).join(', ')}). Ensure exchange rates are current.`,
      action: 'recommended'
    });
  }

  return recommendations;
}

// Calculate estimated processing time
function calculateProcessingTime(itemCount) {
  // Rough estimate: 100 items per second
  const seconds = Math.ceil(itemCount / 100);
  
  if (seconds < 60) {
    return `${seconds} second(s)`;
  } else if (seconds < 3600) {
    return `${Math.ceil(seconds / 60)} minute(s)`;
  } else {
    return `${Math.ceil(seconds / 3600)} hour(s)`;
  }
}

// Export business rules for external use
export { BUSINESS_RULES, SUPPORTED_UOM };