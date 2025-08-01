/**
 * Price Rules Engine Service
 * Handles complex pricing calculations including:
 * - Markup and discount rules
 * - Tier pricing structures
 * - Dynamic pricing based on quantity breaks
 * - Currency conversion and rounding
 * - Seasonal and promotional pricing
 * - Cost-plus pricing models
 */

export class PriceRulesEngine {
  constructor() {
    this.ruleTypes = {
      MARKUP: 'markup',
      DISCOUNT: 'discount',
      TIER_PRICING: 'tier_pricing',
      QUANTITY_BREAK: 'quantity_break',
      COST_PLUS: 'cost_plus',
      PROMOTIONAL: 'promotional',
      SEASONAL: 'seasonal',
      CURRENCY_ADJUSTMENT: 'currency_adjustment'
    };

    this.defaultRules = {
      roundingPrecision: 2,
      minimumPrice: 0.01,
      maximumMarkup: 1000, // 1000% markup limit
      currencyRounding: {
        USD: 2,
        EUR: 2,
        GBP: 2,
        JPY: 0,
        CAD: 2,
        AUD: 2
      }
    };
  }

  /**
   * Apply price rules to a dataset
   */
  async applyRules(data, rulesConfig = {}) {
    try {
      const config = { ...this.defaultRules, ...rulesConfig };
      const processedData = [];
      const summary = {
        totalItems: data.length,
        newItems: 0,
        updatedItems: 0,
        totalValue: 0,
        averageMarkup: 0,
        priceRanges: {},
        appliedRules: []
      };

      for (const item of data) {
        const processedItem = await this.processItem(item, config);
        processedData.push(processedItem);
        
        // Update summary
        summary.totalValue += processedItem.unitPrice;
        if (processedItem.isNewItem) summary.newItems++;
        else summary.updatedItems++;
      }

      // Calculate additional summary metrics
      summary.averagePrice = summary.totalValue / summary.totalItems;
      summary.appliedRules = this.getAppliedRulesSummary(config);

      return {
        success: true,
        data: processedData,
        summary
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        data: data // Return original data if processing fails
      };
    }
  }

  /**
   * Process individual item with price rules
   */
  async processItem(item, config) {
    let processedItem = { ...item };
    
    // Apply cost-plus pricing if base cost is provided
    if (config.costPlusRules && item.baseCost) {
      processedItem = this.applyCostPlusRules(processedItem, config.costPlusRules);
    }

    // Apply markup rules
    if (config.markupRules) {
      processedItem = this.applyMarkupRules(processedItem, config.markupRules);
    }

    // Apply discount rules
    if (config.discountRules) {
      processedItem = this.applyDiscountRules(processedItem, config.discountRules);
    }

    // Generate tier pricing
    if (config.tierPricingRules) {
      processedItem = this.generateTierPricing(processedItem, config.tierPricingRules);
    }

    // Apply quantity break rules
    if (config.quantityBreakRules) {
      processedItem = this.applyQuantityBreakRules(processedItem, config.quantityBreakRules);
    }

    // Apply promotional pricing
    if (config.promotionalRules) {
      processedItem = this.applyPromotionalRules(processedItem, config.promotionalRules);
    }

    // Apply seasonal adjustments
    if (config.seasonalRules) {
      processedItem = this.applySeasonalRules(processedItem, config.seasonalRules);
    }

    // Apply currency adjustments
    if (config.currencyRules) {
      processedItem = this.applyCurrencyRules(processedItem, config.currencyRules);
    }

    // Final price validation and rounding
    processedItem = this.finalizePrice(processedItem, config);

    return processedItem;
  }

  /**
   * Apply cost-plus pricing rules
   */
  applyCostPlusRules(item, rules) {
    const { markupPercent = 0, fixedMarkup = 0, minimumMargin = 0 } = rules;
    
    if (!item.baseCost || item.baseCost <= 0) {
      return item;
    }

    let price = item.baseCost;
    
    // Apply percentage markup
    if (markupPercent > 0) {
      price = price * (1 + markupPercent / 100);
    }
    
    // Apply fixed markup
    if (fixedMarkup > 0) {
      price += fixedMarkup;
    }
    
    // Ensure minimum margin
    if (minimumMargin > 0) {
      const minPrice = item.baseCost + minimumMargin;
      price = Math.max(price, minPrice);
    }

    return {
      ...item,
      unitPrice: price,
      originalPrice: item.unitPrice,
      costPlusMarkup: markupPercent,
      fixedMarkupAmount: fixedMarkup,
      priceCalculationMethod: 'cost_plus'
    };
  }

  /**
   * Apply markup rules based on categories, suppliers, or product attributes
   */
  applyMarkupRules(item, rules) {
    let markup = 0;
    const appliedRules = [];

    // Category-based markup
    if (rules.byCategory && item.category) {
      const categoryRule = rules.byCategory[item.category] || rules.byCategory.default;
      if (categoryRule) {
        markup += categoryRule.percent || 0;
        appliedRules.push(`Category markup: ${categoryRule.percent}%`);
      }
    }

    // Supplier-based markup
    if (rules.bySupplier && item.supplierId) {
      const supplierRule = rules.bySupplier[item.supplierId] || rules.bySupplier.default;
      if (supplierRule) {
        markup += supplierRule.percent || 0;
        appliedRules.push(`Supplier markup: ${supplierRule.percent}%`);
      }
    }

    // Price range-based markup
    if (rules.byPriceRange && item.unitPrice) {
      const priceRule = this.findPriceRangeRule(item.unitPrice, rules.byPriceRange);
      if (priceRule) {
        markup += priceRule.percent || 0;
        appliedRules.push(`Price range markup: ${priceRule.percent}%`);
      }
    }

    // Apply default markup if no specific rules matched
    if (markup === 0 && rules.default) {
      markup = rules.default.percent || 0;
      appliedRules.push(`Default markup: ${markup}%`);
    }

    const finalPrice = item.unitPrice * (1 + markup / 100);

    return {
      ...item,
      unitPrice: finalPrice,
      originalPrice: item.unitPrice,
      appliedMarkup: markup,
      markupRules: appliedRules
    };
  }

  /**
   * Apply discount rules
   */
  applyDiscountRules(item, rules) {
    let discount = 0;
    const appliedRules = [];

    // Volume-based discounts
    if (rules.byVolume && item.minimumOrderQuantity) {
      const volumeRule = this.findVolumeDiscountRule(item.minimumOrderQuantity, rules.byVolume);
      if (volumeRule) {
        discount += volumeRule.percent || 0;
        appliedRules.push(`Volume discount: ${volumeRule.percent}%`);
      }
    }

    // Customer tier discounts
    if (rules.byCustomerTier && item.customerTier) {
      const tierRule = rules.byCustomerTier[item.customerTier];
      if (tierRule) {
        discount += tierRule.percent || 0;
        appliedRules.push(`Customer tier discount: ${tierRule.percent}%`);
      }
    }

    // Product-specific discounts
    if (rules.byProduct && item.sku) {
      const productRule = rules.byProduct[item.sku];
      if (productRule) {
        discount += productRule.percent || 0;
        appliedRules.push(`Product discount: ${productRule.percent}%`);
      }
    }

    const finalPrice = item.unitPrice * (1 - discount / 100);

    return {
      ...item,
      unitPrice: Math.max(finalPrice, rules.minimumPrice || 0),
      originalPrice: item.unitPrice,
      appliedDiscount: discount,
      discountRules: appliedRules
    };
  }

  /**
   * Generate tier pricing structure
   */
  generateTierPricing(item, rules) {
    const tierPricing = [];
    const basePrice = item.unitPrice;

    // Standard tier structure
    const standardTiers = rules.standardTiers || [
      { minQuantity: 1, discountPercent: 0 },
      { minQuantity: 10, discountPercent: 5 },
      { minQuantity: 50, discountPercent: 10 },
      { minQuantity: 100, discountPercent: 15 },
      { minQuantity: 500, discountPercent: 20 }
    ];

    // Custom tiers for specific products/categories
    let customTiers = null;
    if (rules.customTiers) {
      if (rules.customTiers.byCategory && item.category) {
        customTiers = rules.customTiers.byCategory[item.category];
      } else if (rules.customTiers.byProduct && item.sku) {
        customTiers = rules.customTiers.byProduct[item.sku];
      }
    }

    const tiersToUse = customTiers || standardTiers;

    tiersToUse.forEach(tier => {
      const tierPrice = basePrice * (1 - tier.discountPercent / 100);
      tierPricing.push({
        minQuantity: tier.minQuantity,
        price: this.roundPrice(tierPrice, item.currency),
        discountPercent: tier.discountPercent,
        savings: this.roundPrice(basePrice - tierPrice, item.currency)
      });
    });

    return {
      ...item,
      tierPricing,
      hasTierPricing: tierPricing.length > 1
    };
  }

  /**
   * Apply quantity break rules
   */
  applyQuantityBreakRules(item, rules) {
    if (!rules.enabled || !item.minimumOrderQuantity) {
      return item;
    }

    const breaks = rules.breaks || [];
    let applicableBreak = null;

    // Find the highest quantity break that applies
    for (const qtyBreak of breaks.sort((a, b) => b.minQuantity - a.minQuantity)) {
      if (item.minimumOrderQuantity >= qtyBreak.minQuantity) {
        applicableBreak = qtyBreak;
        break;
      }
    }

    if (!applicableBreak) {
      return item;
    }

    const adjustedPrice = item.unitPrice * (1 - applicableBreak.discountPercent / 100);

    return {
      ...item,
      unitPrice: adjustedPrice,
      originalPrice: item.unitPrice,
      quantityBreakApplied: {
        minQuantity: applicableBreak.minQuantity,
        discountPercent: applicableBreak.discountPercent,
        savings: this.roundPrice(item.unitPrice - adjustedPrice, item.currency)
      }
    };
  }

  /**
   * Apply promotional pricing
   */
  applyPromotionalRules(item, rules) {
    if (!rules.enabled || !rules.promotions) {
      return item;
    }

    const currentDate = new Date();
    let bestPromotion = null;
    let maxDiscount = 0;

    // Find the best applicable promotion
    for (const promo of rules.promotions) {
      const startDate = new Date(promo.startDate);
      const endDate = new Date(promo.endDate);
      
      // Check if promotion is currently active
      if (currentDate >= startDate && currentDate <= endDate) {
        // Check if item qualifies
        if (this.itemQualifiesForPromotion(item, promo)) {
          if (promo.discountPercent > maxDiscount) {
            maxDiscount = promo.discountPercent;
            bestPromotion = promo;
          }
        }
      }
    }

    if (!bestPromotion) {
      return item;
    }

    const promotionalPrice = item.unitPrice * (1 - bestPromotion.discountPercent / 100);

    return {
      ...item,
      unitPrice: promotionalPrice,
      originalPrice: item.unitPrice,
      promotionalPricing: {
        promotionId: bestPromotion.id,
        promotionName: bestPromotion.name,
        discountPercent: bestPromotion.discountPercent,
        startDate: bestPromotion.startDate,
        endDate: bestPromotion.endDate,
        savings: this.roundPrice(item.unitPrice - promotionalPrice, item.currency)
      }
    };
  }

  /**
   * Apply seasonal pricing adjustments
   */
  applySeasonalRules(item, rules) {
    if (!rules.enabled || !rules.seasonalAdjustments) {
      return item;
    }

    const currentMonth = new Date().getMonth() + 1; // 1-12
    const currentSeason = this.getCurrentSeason(currentMonth);
    
    let seasonalAdjustment = 0;
    
    // Check for season-specific rules
    if (rules.seasonalAdjustments[currentSeason]) {
      const seasonRule = rules.seasonalAdjustments[currentSeason];
      
      // Check if item qualifies (by category, etc.)
      if (this.itemQualifiesForSeason(item, seasonRule)) {
        seasonalAdjustment = seasonRule.adjustmentPercent || 0;
      }
    }

    if (seasonalAdjustment === 0) {
      return item;
    }

    const seasonalPrice = item.unitPrice * (1 + seasonalAdjustment / 100);

    return {
      ...item,
      unitPrice: seasonalPrice,
      originalPrice: item.unitPrice,
      seasonalAdjustment: {
        season: currentSeason,
        adjustmentPercent: seasonalAdjustment,
        adjustmentAmount: this.roundPrice(seasonalPrice - item.unitPrice, item.currency)
      }
    };
  }

  /**
   * Apply currency-specific rules and conversions
   */
  applyCurrencyRules(item, rules) {
    if (!rules.enabled || !item.currency) {
      return item;
    }

    let adjustedPrice = item.unitPrice;
    const appliedRules = [];

    // Currency-specific markup/discount
    if (rules.currencyAdjustments && rules.currencyAdjustments[item.currency]) {
      const currencyRule = rules.currencyAdjustments[item.currency];
      if (currencyRule.adjustmentPercent) {
        adjustedPrice = adjustedPrice * (1 + currencyRule.adjustmentPercent / 100);
        appliedRules.push(`${item.currency} adjustment: ${currencyRule.adjustmentPercent}%`);
      }
    }

    // Currency conversion if needed
    if (rules.targetCurrency && rules.targetCurrency !== item.currency) {
      const convertedPrice = this.convertCurrency(
        adjustedPrice, 
        item.currency, 
        rules.targetCurrency, 
        rules.exchangeRates
      );
      
      if (convertedPrice !== null) {
        appliedRules.push(`Converted from ${item.currency} to ${rules.targetCurrency}`);
        return {
          ...item,
          unitPrice: convertedPrice,
          originalPrice: item.unitPrice,
          originalCurrency: item.currency,
          currency: rules.targetCurrency,
          currencyRules: appliedRules,
          exchangeRate: rules.exchangeRates[`${item.currency}_${rules.targetCurrency}`]
        };
      }
    }

    return {
      ...item,
      unitPrice: adjustedPrice,
      originalPrice: item.unitPrice,
      currencyRules: appliedRules
    };
  }

  /**
   * Finalize price with rounding and validation
   */
  finalizePrice(item, config) {
    let finalPrice = item.unitPrice;

    // Apply minimum price
    if (config.minimumPrice && finalPrice < config.minimumPrice) {
      finalPrice = config.minimumPrice;
    }

    // Round to appropriate precision
    finalPrice = this.roundPrice(finalPrice, item.currency, config);

    // Calculate total savings if there were adjustments
    const totalSavings = item.originalPrice && item.originalPrice !== finalPrice
      ? this.roundPrice(item.originalPrice - finalPrice, item.currency, config)
      : 0;

    const savingsPercent = item.originalPrice && item.originalPrice > 0
      ? Math.round((totalSavings / item.originalPrice) * 100 * 100) / 100
      : 0;

    return {
      ...item,
      unitPrice: finalPrice,
      totalSavings,
      savingsPercent,
      priceProcessed: true,
      processedAt: new Date().toISOString()
    };
  }

  // ====================
  // HELPER METHODS
  // ====================

  /**
   * Round price to appropriate precision based on currency
   */
  roundPrice(price, currency = 'USD', config = {}) {
    const precision = config.currencyRounding?.[currency] ?? this.defaultRules.currencyRounding[currency] ?? 2;
    return Math.round(price * Math.pow(10, precision)) / Math.pow(10, precision);
  }

  /**
   * Convert currency using provided exchange rates
   */
  convertCurrency(amount, fromCurrency, toCurrency, exchangeRates) {
    if (fromCurrency === toCurrency) return amount;
    
    const rateKey = `${fromCurrency}_${toCurrency}`;
    const rate = exchangeRates?.[rateKey];
    
    if (!rate) {
      console.warn(`Exchange rate not found for ${rateKey}`);
      return null;
    }
    
    return amount * rate;
  }

  /**
   * Find applicable price range rule
   */
  findPriceRangeRule(price, priceRanges) {
    for (const range of priceRanges) {
      if (price >= range.minPrice && (range.maxPrice === null || price <= range.maxPrice)) {
        return range;
      }
    }
    return null;
  }

  /**
   * Find applicable volume discount rule
   */
  findVolumeDiscountRule(quantity, volumeRules) {
    // Find the highest volume rule that applies
    let applicableRule = null;
    for (const rule of volumeRules.sort((a, b) => b.minQuantity - a.minQuantity)) {
      if (quantity >= rule.minQuantity) {
        applicableRule = rule;
        break;
      }
    }
    return applicableRule;
  }

  /**
   * Check if item qualifies for promotion
   */
  itemQualifiesForPromotion(item, promotion) {
    // Check category requirements
    if (promotion.categories && promotion.categories.length > 0) {
      if (!promotion.categories.includes(item.category)) {
        return false;
      }
    }

    // Check SKU requirements
    if (promotion.skus && promotion.skus.length > 0) {
      if (!promotion.skus.includes(item.sku)) {
        return false;
      }
    }

    // Check minimum price requirements
    if (promotion.minPrice && item.unitPrice < promotion.minPrice) {
      return false;
    }

    // Check supplier requirements
    if (promotion.suppliers && promotion.suppliers.length > 0) {
      if (!promotion.suppliers.includes(item.supplierId)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get current season based on month
   */
  getCurrentSeason(month) {
    if (month >= 3 && month <= 5) return 'spring';
    if (month >= 6 && month <= 8) return 'summer';
    if (month >= 9 && month <= 11) return 'fall';
    return 'winter';
  }

  /**
   * Check if item qualifies for seasonal adjustment
   */
  itemQualifiesForSeason(item, seasonRule) {
    if (seasonRule.categories && seasonRule.categories.length > 0) {
      return seasonRule.categories.includes(item.category);
    }
    return true; // Default to qualify if no specific requirements
  }

  /**
   * Get summary of applied rules
   */
  getAppliedRulesSummary(config) {
    const summary = [];
    
    if (config.markupRules) summary.push('Markup Rules');
    if (config.discountRules) summary.push('Discount Rules');
    if (config.tierPricingRules) summary.push('Tier Pricing');
    if (config.quantityBreakRules?.enabled) summary.push('Quantity Breaks');
    if (config.promotionalRules?.enabled) summary.push('Promotional Pricing');
    if (config.seasonalRules?.enabled) summary.push('Seasonal Adjustments');
    if (config.currencyRules?.enabled) summary.push('Currency Rules');
    
    return summary;
  }

  /**
   * Validate price rules configuration
   */
  validateRulesConfig(config) {
    const errors = [];
    const warnings = [];

    // Validate markup rules
    if (config.markupRules) {
      if (config.markupRules.default?.percent > this.defaultRules.maximumMarkup) {
        warnings.push(`Default markup exceeds recommended maximum of ${this.defaultRules.maximumMarkup}%`);
      }
    }

    // Validate currency rules
    if (config.currencyRules?.enabled && !config.currencyRules.exchangeRates) {
      errors.push('Currency rules enabled but no exchange rates provided');
    }

    // Validate promotional rules
    if (config.promotionalRules?.enabled && config.promotionalRules.promotions) {
      config.promotionalRules.promotions.forEach((promo, index) => {
        if (!promo.startDate || !promo.endDate) {
          errors.push(`Promotion ${index + 1} missing start or end date`);
        }
        if (new Date(promo.startDate) >= new Date(promo.endDate)) {
          errors.push(`Promotion ${index + 1} has invalid date range`);
        }
      });
    }

    return { valid: errors.length === 0, errors, warnings };
  }
}

// Export singleton instance
export const priceRulesEngine = new PriceRulesEngine();
export default priceRulesEngine;