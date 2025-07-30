// Centralized business rules engine for supplier price list processing
export class BusinessRulesEngine {
  constructor() {
    // Currency configuration
    this.supportedCurrencies = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CNY', 'INR', 'CHF', 'SEK', 'NOK', 'ZAR'];
    this.defaultCurrency = 'USD';
    
    // Pricing rules
    this.pricingRules = {
      minUnitPrice: 0.01,
      maxUnitPrice: 999999.99,
      maxDiscountPercent: 95,
      minMarkupPercent: -50,
      maxMarkupPercent: 500
    };
    
    // SKU rules
    this.skuRules = {
      minLength: 3,
      maxLength: 50,
      pattern: /^[A-Z0-9][A-Z0-9-_]*$/i,
      reservedPrefixes: ['TEMP-', 'TEST-', 'DEMO-'],
      duplicateHandling: 'reject' // 'reject', 'update', 'version'
    };
    
    // Order quantity rules
    this.quantityRules = {
      minMOQ: 1,
      maxMOQ: 999999,
      allowFractional: false,
      roundingMethod: 'up' // 'up', 'down', 'nearest'
    };
    
    // Upload rules
    this.uploadRules = {
      maxFileSize: 50 * 1024 * 1024, // 50MB
      maxItemsPerUpload: 50000,
      warningThreshold: 10000,
      concurrentUploadsPerSupplier: 5,
      requireApproval: true,
      autoApproveThreshold: 100 // Auto-approve if less than 100 items
    };
    
    // Price list rules
    this.priceListRules = {
      maxActivePriceLists: 1,
      versionRetentionDays: 365,
      effectiveDateBuffer: 0, // Days before price list can be effective
      expiryWarningDays: 30,
      requireApprovalForChanges: true,
      priceChangeThreshold: 10 // Percentage change requiring special approval
    };
    
    // Supplier rules
    this.supplierRules = {
      requireApproval: true,
      inactivityDays: 180, // Mark inactive after 180 days
      performanceThreshold: 0.8, // Minimum performance rating
      creditCheckRequired: true,
      requiredDocuments: ['business_license', 'tax_certificate']
    };
  }
  
  // Validate SKU format
  validateSKU(sku) {
    const result = {
      valid: true,
      errors: [],
      warnings: [],
      normalizedSKU: sku?.trim().toUpperCase()
    };
    
    if (!sku || typeof sku !== 'string') {
      result.valid = false;
      result.errors.push('SKU is required and must be a string');
      return result;
    }
    
    const trimmedSKU = sku.trim();
    
    // Length validation
    if (trimmedSKU.length < this.skuRules.minLength) {
      result.valid = false;
      result.errors.push(`SKU must be at least ${this.skuRules.minLength} characters`);
    }
    
    if (trimmedSKU.length > this.skuRules.maxLength) {
      result.valid = false;
      result.errors.push(`SKU must not exceed ${this.skuRules.maxLength} characters`);
    }
    
    // Pattern validation
    if (!this.skuRules.pattern.test(trimmedSKU)) {
      result.valid = false;
      result.errors.push('SKU must contain only letters, numbers, hyphens, and underscores');
    }
    
    // Reserved prefix check
    for (const prefix of this.skuRules.reservedPrefixes) {
      if (trimmedSKU.toUpperCase().startsWith(prefix)) {
        result.warnings.push(`SKU starts with reserved prefix: ${prefix}`);
      }
    }
    
    return result;
  }
  
  // Validate price
  validatePrice(price, currency = 'USD') {
    const result = {
      valid: true,
      errors: [],
      warnings: [],
      normalizedPrice: 0
    };
    
    const numPrice = parseFloat(price);
    
    if (isNaN(numPrice)) {
      result.valid = false;
      result.errors.push('Price must be a valid number');
      return result;
    }
    
    if (numPrice < this.pricingRules.minUnitPrice) {
      result.valid = false;
      result.errors.push(`Price must be at least ${this.pricingRules.minUnitPrice}`);
    }
    
    if (numPrice > this.pricingRules.maxUnitPrice) {
      result.valid = false;
      result.errors.push(`Price must not exceed ${this.pricingRules.maxUnitPrice}`);
    }
    
    // Round to 2 decimal places
    result.normalizedPrice = Math.round(numPrice * 100) / 100;
    
    // Currency validation
    if (!this.supportedCurrencies.includes(currency)) {
      result.warnings.push(`Currency ${currency} is not officially supported`);
    }
    
    // Price reasonableness checks
    if (numPrice < 0.10 && currency === 'USD') {
      result.warnings.push('Price seems unusually low');
    }
    
    if (numPrice > 10000) {
      result.warnings.push('Price seems unusually high - please verify');
    }
    
    return result;
  }
  
  // Validate quantity
  validateQuantity(quantity, context = {}) {
    const result = {
      valid: true,
      errors: [],
      warnings: [],
      normalizedQuantity: 1
    };
    
    const numQty = parseFloat(quantity);
    
    if (isNaN(numQty) || numQty < this.quantityRules.minMOQ) {
      result.normalizedQuantity = this.quantityRules.minMOQ;
      result.warnings.push(`Quantity adjusted to minimum: ${this.quantityRules.minMOQ}`);
    } else if (numQty > this.quantityRules.maxMOQ) {
      result.valid = false;
      result.errors.push(`Quantity exceeds maximum: ${this.quantityRules.maxMOQ}`);
    } else {
      // Handle fractional quantities
      if (!this.quantityRules.allowFractional && numQty % 1 !== 0) {
        switch (this.quantityRules.roundingMethod) {
          case 'up':
            result.normalizedQuantity = Math.ceil(numQty);
            break;
          case 'down':
            result.normalizedQuantity = Math.floor(numQty);
            break;
          case 'nearest':
            result.normalizedQuantity = Math.round(numQty);
            break;
        }
        result.warnings.push(`Quantity rounded from ${numQty} to ${result.normalizedQuantity}`);
      } else {
        result.normalizedQuantity = numQty;
      }
    }
    
    return result;
  }
  
  // Validate entire price list item
  validatePriceListItem(item) {
    const result = {
      valid: true,
      errors: [],
      warnings: [],
      normalizedItem: {}
    };
    
    // Validate SKU
    const skuResult = this.validateSKU(item.sku);
    if (!skuResult.valid) {
      result.valid = false;
      result.errors.push(...skuResult.errors);
    }
    result.warnings.push(...skuResult.warnings);
    result.normalizedItem.sku = skuResult.normalizedSKU;
    
    // Validate price
    const priceResult = this.validatePrice(item.unitPrice, item.currency);
    if (!priceResult.valid) {
      result.valid = false;
      result.errors.push(...priceResult.errors);
    }
    result.warnings.push(...priceResult.warnings);
    result.normalizedItem.unitPrice = priceResult.normalizedPrice;
    
    // Validate quantity
    const qtyResult = this.validateQuantity(item.minimumOrderQuantity);
    if (!qtyResult.valid) {
      result.valid = false;
      result.errors.push(...qtyResult.errors);
    }
    result.warnings.push(...qtyResult.warnings);
    result.normalizedItem.minimumOrderQuantity = qtyResult.normalizedQuantity;
    
    // Set defaults and normalize other fields
    result.normalizedItem.currency = item.currency || this.defaultCurrency;
    result.normalizedItem.description = (item.description || '').trim();
    result.normalizedItem.unitOfMeasure = (item.unitOfMeasure || 'EA').toUpperCase();
    
    // Validate tier pricing if present
    if (item.tierPricing && Array.isArray(item.tierPricing)) {
      result.normalizedItem.tierPricing = this.validateTierPricing(
        item.tierPricing, 
        result.normalizedItem.unitPrice
      );
    }
    
    return result;
  }
  
  // Validate tier pricing
  validateTierPricing(tiers, basePrice) {
    const validTiers = [];
    
    const sortedTiers = [...tiers].sort((a, b) => a.minQuantity - b.minQuantity);
    
    for (let i = 0; i < sortedTiers.length; i++) {
      const tier = sortedTiers[i];
      
      // Validate tier structure
      if (!tier.minQuantity || !tier.price) continue;
      
      const normalizedTier = {
        minQuantity: parseInt(tier.minQuantity),
        price: parseFloat(tier.price)
      };
      
      // Ensure tier price is valid
      if (isNaN(normalizedTier.price) || normalizedTier.price <= 0) continue;
      
      // Ensure tier quantity is valid
      if (isNaN(normalizedTier.minQuantity) || normalizedTier.minQuantity <= 1) continue;
      
      // Calculate discount percentage
      const discountPercent = ((basePrice - normalizedTier.price) / basePrice) * 100;
      
      // Validate discount is reasonable
      if (discountPercent > this.pricingRules.maxDiscountPercent) {
        continue; // Skip tiers with excessive discount
      }
      
      // Ensure progressive discounting
      if (i > 0 && normalizedTier.price >= validTiers[i - 1].price) {
        continue; // Skip if price doesn't decrease with quantity
      }
      
      normalizedTier.discountPercent = Math.round(discountPercent * 100) / 100;
      validTiers.push(normalizedTier);
    }
    
    return validTiers;
  }
  
  // Check for duplicate SKUs
  async checkDuplicateSKUs(items, existingItems = []) {
    const duplicates = new Map();
    const skuMap = new Map();
    
    // Build map of existing SKUs
    existingItems.forEach(item => {
      skuMap.set(item.sku.toUpperCase(), {
        source: 'existing',
        item: item
      });
    });
    
    // Check new items
    items.forEach((item, index) => {
      const skuUpper = item.sku?.toUpperCase();
      if (!skuUpper) return;
      
      if (skuMap.has(skuUpper)) {
        if (!duplicates.has(skuUpper)) {
          duplicates.set(skuUpper, []);
        }
        duplicates.get(skuUpper).push({
          index,
          item,
          conflictsWith: skuMap.get(skuUpper)
        });
      } else {
        skuMap.set(skuUpper, {
          source: 'new',
          index,
          item
        });
      }
    });
    
    return {
      hasDuplicates: duplicates.size > 0,
      duplicates: Array.from(duplicates.entries()).map(([sku, conflicts]) => ({
        sku,
        conflicts,
        resolution: this.suggestDuplicateResolution(sku, conflicts)
      }))
    };
  }
  
  // Suggest resolution for duplicate SKUs
  suggestDuplicateResolution(sku, conflicts) {
    switch (this.skuRules.duplicateHandling) {
      case 'reject':
        return {
          action: 'reject',
          message: 'Remove duplicate SKUs before uploading'
        };
        
      case 'update':
        return {
          action: 'update',
          message: 'Update existing item with new price/details'
        };
        
      case 'version':
        return {
          action: 'version',
          message: `Create new version: ${sku}-V${Date.now()}`,
          newSKU: `${sku}-V${Date.now()}`
        };
        
      default:
        return {
          action: 'manual',
          message: 'Manual review required'
        };
    }
  }
  
  // Validate upload file
  validateUploadFile(file) {
    const result = {
      valid: true,
      errors: [],
      warnings: []
    };
    
    // Check file size
    if (file.size > this.uploadRules.maxFileSize) {
      result.valid = false;
      result.errors.push(`File size exceeds maximum of ${this.uploadRules.maxFileSize / 1024 / 1024}MB`);
    }
    
    // Check file type
    const validTypes = ['csv', 'xlsx', 'xls', 'json', 'xml', 'pdf', 'doc', 'docx', 'eml', 'msg'];
    const extension = file.originalname?.split('.').pop()?.toLowerCase();
    
    if (!extension || !validTypes.includes(extension)) {
      result.valid = false;
      result.errors.push(`Invalid file type. Supported types: ${validTypes.join(', ')}`);
    }
    
    return result;
  }
  
  // Apply approval workflow rules
  determineApprovalRequired(priceList, items, existingPriceList = null) {
    const reasons = [];
    
    // Check if approval is always required
    if (this.priceListRules.requireApprovalForChanges) {
      reasons.push('Price list changes require approval by policy');
    }
    
    // Check item count threshold
    if (items.length > this.uploadRules.autoApproveThreshold) {
      reasons.push(`Item count (${items.length}) exceeds auto-approval threshold`);
    }
    
    // Check for significant price changes
    if (existingPriceList) {
      const significantChanges = this.checkSignificantPriceChanges(
        items, 
        existingPriceList.items
      );
      
      if (significantChanges.count > 0) {
        reasons.push(`${significantChanges.count} items have price changes >${this.priceListRules.priceChangeThreshold}%`);
      }
    }
    
    // Check effective date
    const effectiveDate = new Date(priceList.effectiveDate);
    const today = new Date();
    const daysDiff = Math.floor((effectiveDate - today) / (1000 * 60 * 60 * 24));
    
    if (daysDiff < this.priceListRules.effectiveDateBuffer) {
      reasons.push('Immediate effective date requires approval');
    }
    
    return {
      required: reasons.length > 0,
      reasons,
      autoApprove: reasons.length === 0 && items.length < this.uploadRules.autoApproveThreshold
    };
  }
  
  // Check for significant price changes
  checkSignificantPriceChanges(newItems, existingItems) {
    const existingMap = new Map(
      existingItems.map(item => [item.sku.toUpperCase(), item])
    );
    
    const changes = [];
    
    for (const newItem of newItems) {
      const existing = existingMap.get(newItem.sku.toUpperCase());
      if (!existing) continue;
      
      const priceChange = Math.abs(
        ((newItem.unitPrice - existing.unitPrice) / existing.unitPrice) * 100
      );
      
      if (priceChange > this.priceListRules.priceChangeThreshold) {
        changes.push({
          sku: newItem.sku,
          oldPrice: existing.unitPrice,
          newPrice: newItem.unitPrice,
          changePercent: priceChange,
          direction: newItem.unitPrice > existing.unitPrice ? 'increase' : 'decrease'
        });
      }
    }
    
    return {
      count: changes.length,
      changes,
      requiresApproval: changes.length > 0
    };
  }
  
  // Calculate supplier payment terms
  calculatePaymentTerms(supplier, order) {
    const terms = supplier.paymentTerms || {};
    const baseTerms = terms.daysDue || 30;
    
    let finalTerms = baseTerms;
    
    // Apply early payment discount
    if (terms.earlyPaymentDiscount && terms.earlyPaymentDays) {
      return {
        standardDue: baseTerms,
        earlyPaymentDays: terms.earlyPaymentDays,
        earlyPaymentDiscount: terms.earlyPaymentDiscount,
        netAmount: order.totalAmount,
        discountedAmount: order.totalAmount * (1 - terms.earlyPaymentDiscount / 100)
      };
    }
    
    // Apply volume-based terms
    if (terms.volumeBasedTerms && order.totalAmount > terms.volumeThreshold) {
      finalTerms = terms.volumeTermsDays || baseTerms;
    }
    
    return {
      standardDue: finalTerms,
      netAmount: order.totalAmount
    };
  }
  
  // Validate supplier status
  validateSupplierStatus(supplier) {
    const result = {
      active: true,
      warnings: [],
      actions: []
    };
    
    // Check if supplier is approved
    if (!supplier.isApproved) {
      result.active = false;
      result.warnings.push('Supplier is not approved');
      result.actions.push('Require approval before processing orders');
    }
    
    // Check last activity
    if (supplier.lastActivityDate) {
      const daysSinceActivity = Math.floor(
        (Date.now() - new Date(supplier.lastActivityDate)) / (1000 * 60 * 60 * 24)
      );
      
      if (daysSinceActivity > this.supplierRules.inactivityDays) {
        result.warnings.push(`Supplier inactive for ${daysSinceActivity} days`);
        result.actions.push('Consider marking as inactive');
      }
    }
    
    // Check performance rating
    if (supplier.performanceRating < this.supplierRules.performanceThreshold) {
      result.warnings.push(`Low performance rating: ${supplier.performanceRating}`);
      result.actions.push('Review supplier performance');
    }
    
    // Check required documents
    const missingDocs = this.supplierRules.requiredDocuments.filter(
      doc => !supplier.documents || !supplier.documents[doc]
    );
    
    if (missingDocs.length > 0) {
      result.warnings.push(`Missing documents: ${missingDocs.join(', ')}`);
      result.actions.push('Request missing documentation');
    }
    
    return result;
  }
  
  // Get business rule configuration
  getConfiguration() {
    return {
      currencies: this.supportedCurrencies,
      pricing: this.pricingRules,
      sku: this.skuRules,
      quantity: this.quantityRules,
      upload: this.uploadRules,
      priceList: this.priceListRules,
      supplier: this.supplierRules
    };
  }
  
  // Update business rule configuration
  updateConfiguration(updates) {
    // This would typically persist to database
    Object.assign(this, updates);
    return this.getConfiguration();
  }
}

// Export singleton instance
export const businessRules = new BusinessRulesEngine();

// Export for testing
export default BusinessRulesEngine;