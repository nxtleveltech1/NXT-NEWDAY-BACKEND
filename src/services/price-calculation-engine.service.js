import { db } from '../config/database.js';
import { priceLists, priceListItems, products, inventory, suppliers } from '../db/schema.js';
import { eq, and, sql, desc, lte, gte } from 'drizzle-orm';

/**
 * Price Calculation Engine Service
 * Handles complex pricing calculations including tier pricing, 
 * multi-currency support, and historical price tracking
 */

// ==================== TIER PRICING LOGIC ====================

/**
 * Calculate the best price based on quantity and tier breaks
 */
export function calculateTierPrice(tierPricing, quantity) {
  if (!tierPricing || !Array.isArray(tierPricing) || tierPricing.length === 0) {
    return null;
  }

  // Sort tiers by minQuantity in descending order
  const sortedTiers = [...tierPricing].sort((a, b) => b.minQuantity - a.minQuantity);

  // Find the applicable tier
  for (const tier of sortedTiers) {
    if (quantity >= tier.minQuantity) {
      return {
        unitPrice: tier.unitPrice,
        tierLevel: tier.name || `Tier ${tier.minQuantity}+`,
        minQuantity: tier.minQuantity,
        discount: tier.discountPercentage || 0
      };
    }
  }

  // No applicable tier found
  return null;
}

/**
 * Calculate price breaks for quantity ranges
 */
export function calculatePriceBreaks(basePrice, tierPricing) {
  if (!tierPricing || !Array.isArray(tierPricing)) {
    return [{
      minQuantity: 1,
      unitPrice: basePrice,
      totalSavings: 0,
      percentSavings: 0
    }];
  }

  const breaks = tierPricing.map(tier => ({
    minQuantity: tier.minQuantity,
    unitPrice: tier.unitPrice,
    totalSavings: basePrice - tier.unitPrice,
    percentSavings: ((basePrice - tier.unitPrice) / basePrice) * 100
  }));

  // Sort by minQuantity
  return breaks.sort((a, b) => a.minQuantity - b.minQuantity);
}

// ==================== MULTI-CURRENCY SUPPORT ====================

/**
 * Currency conversion rates (should be fetched from external API in production)
 */
const CURRENCY_RATES = {
  USD: 1.0,
  EUR: 0.85,
  GBP: 0.73,
  CAD: 1.25,
  AUD: 1.35,
  JPY: 110.0,
  CNY: 6.45
};

/**
 * Convert price between currencies
 */
export function convertCurrency(amount, fromCurrency, toCurrency) {
  if (fromCurrency === toCurrency) {
    return amount;
  }

  const fromRate = CURRENCY_RATES[fromCurrency] || 1.0;
  const toRate = CURRENCY_RATES[toCurrency] || 1.0;

  // Convert to USD first, then to target currency
  const usdAmount = amount / fromRate;
  return usdAmount * toRate;
}

/**
 * Get price in multiple currencies
 */
export function getMultiCurrencyPrices(basePrice, baseCurrency) {
  const prices = {};
  
  for (const [currency, rate] of Object.entries(CURRENCY_RATES)) {
    prices[currency] = convertCurrency(basePrice, baseCurrency, currency);
  }

  return prices;
}

// ==================== PRICE CALCULATION ====================

/**
 * Calculate comprehensive pricing for a product
 */
export async function calculateProductPricing(productSku, supplierId, quantity, options = {}) {
  const {
    currency = 'USD',
    includeShipping = false,
    includeTaxes = false,
    taxRate = 0,
    shippingCost = 0
  } = options;

  // Get active price list
  const activePriceList = await db
    .select()
    .from(priceLists)
    .where(
      and(
        eq(priceLists.supplierId, supplierId),
        eq(priceLists.status, 'active'),
        eq(priceLists.isActive, true),
        lte(priceLists.effectiveDate, new Date())
      )
    )
    .orderBy(desc(priceLists.effectiveDate))
    .limit(1);

  if (!activePriceList[0]) {
    throw new Error('No active price list found for supplier');
  }

  // Get price list item
  const priceItem = await db
    .select()
    .from(priceListItems)
    .where(
      and(
        eq(priceListItems.priceListId, activePriceList[0].id),
        eq(priceListItems.sku, productSku)
      )
    )
    .limit(1);

  if (!priceItem[0]) {
    throw new Error('Product not found in price list');
  }

  const item = priceItem[0];

  // Check MOQ
  if (item.moq && quantity < item.moq) {
    return {
      error: 'BELOW_MOQ',
      message: `Minimum order quantity is ${item.moq}`,
      moq: item.moq,
      requestedQuantity: quantity
    };
  }

  // Base price
  let unitPrice = parseFloat(item.unitPrice);
  let appliedTier = null;

  // Apply tier pricing
  if (item.tierPricing) {
    const tierResult = calculateTierPrice(item.tierPricing, quantity);
    if (tierResult) {
      unitPrice = tierResult.unitPrice;
      appliedTier = tierResult;
    }
  }

  // Apply discounts
  let discountAmount = 0;
  if (item.discountPercentage > 0) {
    discountAmount = unitPrice * (item.discountPercentage / 100);
  }

  const discountedUnitPrice = unitPrice - discountAmount;

  // Calculate subtotal
  const subtotal = discountedUnitPrice * quantity;

  // Add shipping if requested
  const shipping = includeShipping ? shippingCost : 0;

  // Calculate tax if requested
  const taxableAmount = subtotal + shipping;
  const tax = includeTaxes ? taxableAmount * (taxRate / 100) : 0;

  // Total
  const total = subtotal + shipping + tax;

  // Currency conversion
  const targetCurrency = currency !== item.currency;
  const conversionRate = targetCurrency ? 
    CURRENCY_RATES[currency] / CURRENCY_RATES[item.currency] : 1;

  return {
    success: true,
    pricing: {
      productSku,
      supplierId,
      priceListId: activePriceList[0].id,
      quantity,
      
      // Base pricing
      baseUnitPrice: parseFloat(item.unitPrice),
      currency: item.currency,
      
      // Tier pricing
      tierPricing: !!item.tierPricing,
      appliedTier,
      tierUnitPrice: appliedTier ? appliedTier.unitPrice : null,
      
      // Discounts
      discountPercentage: item.discountPercentage || 0,
      discountAmount,
      discountedUnitPrice,
      
      // Totals
      subtotal,
      shipping,
      tax,
      total,
      
      // Currency conversion
      targetCurrency: currency,
      conversionRate,
      convertedTotal: total * conversionRate,
      
      // Additional info
      moq: item.moq,
      leadTimeDays: item.leadTimeDays,
      notes: item.notes,
      
      // Price breaks
      priceBreaks: calculatePriceBreaks(parseFloat(item.unitPrice), item.tierPricing)
    }
  };
}

// ==================== HISTORICAL PRICE TRACKING ====================

/**
 * Get historical prices for a product from a supplier
 */
export async function getHistoricalPrices(productSku, supplierId, options = {}) {
  const {
    dateFrom = null,
    dateTo = null,
    limit = 12  // Default to last 12 price changes
  } = options;

  let whereConditions = [
    eq(priceListItems.sku, productSku),
    eq(priceLists.supplierId, supplierId)
  ];

  if (dateFrom) {
    whereConditions.push(gte(priceLists.effectiveDate, new Date(dateFrom)));
  }
  if (dateTo) {
    whereConditions.push(lte(priceLists.effectiveDate, new Date(dateTo)));
  }

  const historicalPrices = await db
    .select({
      priceListId: priceLists.id,
      priceListName: priceLists.name,
      effectiveDate: priceLists.effectiveDate,
      expiryDate: priceLists.expiryDate,
      status: priceLists.status,
      unitPrice: priceListItems.unitPrice,
      currency: priceListItems.currency,
      moq: priceListItems.moq,
      discountPercentage: priceListItems.discountPercentage,
      hasTierPricing: sql`CASE WHEN ${priceListItems.tierPricing} IS NOT NULL THEN true ELSE false END`
    })
    .from(priceListItems)
    .innerJoin(priceLists, eq(priceListItems.priceListId, priceLists.id))
    .where(and(...whereConditions))
    .orderBy(desc(priceLists.effectiveDate))
    .limit(limit);

  // Calculate price changes
  const priceHistory = historicalPrices.map((price, index) => {
    const previousPrice = historicalPrices[index + 1];
    let priceChange = null;
    let priceChangePercent = null;

    if (previousPrice) {
      priceChange = parseFloat(price.unitPrice) - parseFloat(previousPrice.unitPrice);
      priceChangePercent = (priceChange / parseFloat(previousPrice.unitPrice)) * 100;
    }

    return {
      ...price,
      unitPrice: parseFloat(price.unitPrice),
      priceChange,
      priceChangePercent,
      trend: priceChange ? (priceChange > 0 ? 'up' : 'down') : 'stable'
    };
  });

  // Calculate overall statistics
  const prices = priceHistory.map(p => p.unitPrice);
  const stats = {
    currentPrice: prices[0] || 0,
    lowestPrice: Math.min(...prices),
    highestPrice: Math.max(...prices),
    averagePrice: prices.reduce((sum, p) => sum + p, 0) / prices.length,
    priceVolatility: calculateVolatility(prices),
    totalPriceChanges: priceHistory.filter(p => p.priceChange !== null).length
  };

  return {
    productSku,
    supplierId,
    priceHistory,
    statistics: stats
  };
}

/**
 * Calculate price volatility (standard deviation)
 */
function calculateVolatility(prices) {
  if (prices.length < 2) return 0;

  const mean = prices.reduce((sum, p) => sum + p, 0) / prices.length;
  const squaredDiffs = prices.map(p => Math.pow(p - mean, 2));
  const variance = squaredDiffs.reduce((sum, d) => sum + d, 0) / prices.length;
  
  return Math.sqrt(variance);
}

// ==================== BULK PRICING OPERATIONS ====================

/**
 * Calculate prices for multiple products in bulk
 */
export async function calculateBulkPricing(items, supplierId, options = {}) {
  const results = [];
  const errors = [];

  for (const item of items) {
    try {
      const pricing = await calculateProductPricing(
        item.sku,
        supplierId,
        item.quantity,
        options
      );
      results.push(pricing);
    } catch (error) {
      errors.push({
        sku: item.sku,
        quantity: item.quantity,
        error: error.message
      });
    }
  }

  // Calculate totals
  const successfulItems = results.filter(r => r.success);
  const totals = {
    itemCount: successfulItems.length,
    totalQuantity: successfulItems.reduce((sum, r) => sum + r.pricing.quantity, 0),
    subtotal: successfulItems.reduce((sum, r) => sum + r.pricing.subtotal, 0),
    totalShipping: successfulItems.reduce((sum, r) => sum + r.pricing.shipping, 0),
    totalTax: successfulItems.reduce((sum, r) => sum + r.pricing.tax, 0),
    grandTotal: successfulItems.reduce((sum, r) => sum + r.pricing.total, 0)
  };

  return {
    success: errors.length === 0,
    results,
    errors,
    totals
  };
}

// ==================== COMPETITIVE PRICING ANALYSIS ====================

/**
 * Compare prices across multiple suppliers for the same product
 */
export async function compareSupplierPrices(productSku, quantity) {
  // Get all suppliers that carry this product
  const suppliersWithProduct = await db
    .select({
      supplierId: suppliers.id,
      supplierName: suppliers.companyName,
      supplierCode: suppliers.supplierCode,
      leadTimeDays: suppliers.leadTimeDays
    })
    .from(products)
    .innerJoin(suppliers, eq(products.supplierId, suppliers.id))
    .where(
      and(
        eq(products.sku, productSku),
        eq(suppliers.isActive, true)
      )
    );

  const comparisons = [];

  for (const supplier of suppliersWithProduct) {
    try {
      const pricing = await calculateProductPricing(
        productSku,
        supplier.supplierId,
        quantity
      );

      if (pricing.success) {
        comparisons.push({
          supplierId: supplier.supplierId,
          supplierName: supplier.supplierName,
          supplierCode: supplier.supplierCode,
          leadTimeDays: supplier.leadTimeDays,
          pricing: pricing.pricing,
          totalCost: pricing.pricing.total,
          unitCost: pricing.pricing.discountedUnitPrice
        });
      }
    } catch (error) {
      // Skip suppliers without active price lists
      continue;
    }
  }

  // Sort by total cost
  comparisons.sort((a, b) => a.totalCost - b.totalCost);

  // Calculate savings
  if (comparisons.length > 1) {
    const bestPrice = comparisons[0].totalCost;
    comparisons.forEach((comp, index) => {
      comp.ranking = index + 1;
      comp.savingsVsBest = comp.totalCost - bestPrice;
      comp.savingsPercent = ((comp.totalCost - bestPrice) / bestPrice) * 100;
    });
  }

  return {
    productSku,
    quantity,
    supplierCount: comparisons.length,
    comparisons,
    bestOption: comparisons[0] || null,
    worstOption: comparisons[comparisons.length - 1] || null,
    averagePrice: comparisons.length > 0 ?
      comparisons.reduce((sum, c) => sum + c.totalCost, 0) / comparisons.length : 0
  };
}

// ==================== PRICE OPTIMIZATION ====================

/**
 * Suggest optimal order quantities based on price breaks
 */
export async function suggestOptimalQuantity(productSku, supplierId, targetQuantity) {
  // Get price list item with tier pricing
  const priceData = await db
    .select({
      unitPrice: priceListItems.unitPrice,
      tierPricing: priceListItems.tierPricing,
      moq: priceListItems.moq
    })
    .from(priceListItems)
    .innerJoin(priceLists, eq(priceListItems.priceListId, priceLists.id))
    .where(
      and(
        eq(priceListItems.sku, productSku),
        eq(priceLists.supplierId, supplierId),
        eq(priceLists.status, 'active')
      )
    )
    .limit(1);

  if (!priceData[0]) {
    throw new Error('Product pricing not found');
  }

  const { unitPrice, tierPricing, moq } = priceData[0];
  const basePrice = parseFloat(unitPrice);

  // Ensure target meets MOQ
  const adjustedTarget = Math.max(targetQuantity, moq || 1);

  if (!tierPricing || tierPricing.length === 0) {
    return {
      targetQuantity: adjustedTarget,
      optimalQuantity: adjustedTarget,
      currentTotalCost: adjustedTarget * basePrice,
      optimalTotalCost: adjustedTarget * basePrice,
      savings: 0,
      recommendation: 'No tier pricing available'
    };
  }

  // Calculate current cost
  const currentTier = calculateTierPrice(tierPricing, adjustedTarget);
  const currentUnitPrice = currentTier ? currentTier.unitPrice : basePrice;
  const currentTotalCost = adjustedTarget * currentUnitPrice;

  // Find next tier break
  const sortedTiers = [...tierPricing].sort((a, b) => a.minQuantity - b.minQuantity);
  const nextTier = sortedTiers.find(t => t.minQuantity > adjustedTarget);

  if (!nextTier) {
    return {
      targetQuantity: adjustedTarget,
      optimalQuantity: adjustedTarget,
      currentTotalCost,
      optimalTotalCost: currentTotalCost,
      savings: 0,
      recommendation: 'Already at best price tier'
    };
  }

  // Calculate cost at next tier
  const nextTierTotalCost = nextTier.minQuantity * nextTier.unitPrice;
  const additionalQuantity = nextTier.minQuantity - adjustedTarget;
  const additionalCost = nextTierTotalCost - currentTotalCost;
  const costPerAdditionalUnit = additionalCost / additionalQuantity;

  // Determine if it's worth buying more
  const worthBuyingMore = costPerAdditionalUnit < currentUnitPrice;

  return {
    targetQuantity: adjustedTarget,
    optimalQuantity: worthBuyingMore ? nextTier.minQuantity : adjustedTarget,
    currentTotalCost,
    optimalTotalCost: worthBuyingMore ? nextTierTotalCost : currentTotalCost,
    savings: worthBuyingMore ? (adjustedTarget * currentUnitPrice) - (adjustedTarget * nextTier.unitPrice) : 0,
    additionalQuantity: worthBuyingMore ? additionalQuantity : 0,
    additionalCost: worthBuyingMore ? additionalCost : 0,
    recommendation: worthBuyingMore ?
      `Buy ${additionalQuantity} more units to reach ${nextTier.name || 'next tier'} and save ${((currentUnitPrice - nextTier.unitPrice) / currentUnitPrice * 100).toFixed(1)}% per unit` :
      'Current quantity is optimal'
  };
}