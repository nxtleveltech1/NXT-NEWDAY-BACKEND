import { eq, and, sql, desc, asc, gte, lte, inArray, or } from 'drizzle-orm'
import { db } from '../config/database.js'
import { priceLists, priceListItems, suppliers, products } from './schema.js'

/**
 * Enhanced Pricing Queries
 * Implements comprehensive pricing business logic with tier support,
 * multi-currency handling, and advanced validation
 */

// ==================== ENHANCED PRICE RETRIEVAL ====================

/**
 * Enhanced get supplier price with comprehensive tier support and business rules
 * @param {string} supplierId - Supplier UUID
 * @param {string} sku - Product SKU
 * @param {number} quantity - Requested quantity (default: 1)
 * @param {object} options - Additional options
 * @returns {object} Enhanced price information with tier calculations
 */
export async function getSupplierPriceEnhanced(supplierId, sku, quantity = 1, options = {}) {
  const {
    currency = 'USD',
    effectiveDate = new Date(),
    includeAllTiers = false,
    validateMinQuantity = true,
    fallbackToBase = true
  } = options

  try {
    // Get active price list for supplier with effective date validation
    const activePriceListQuery = await db
      .select({
        id: priceLists.id,
        name: priceLists.name,
        effectiveDate: priceLists.effectiveDate,
        expiryDate: priceLists.expiryDate,
        currency: sql`COALESCE(${priceLists.currency}, 'USD')`,
        supplierName: suppliers.companyName
      })
      .from(priceLists)
      .innerJoin(suppliers, eq(priceLists.supplierId, suppliers.id))
      .where(
        and(
          eq(priceLists.supplierId, supplierId),
          eq(priceLists.status, 'active'),
          gte(sql`COALESCE(${priceLists.expiryDate}, CURRENT_DATE + INTERVAL '1 year')`, effectiveDate),
          lte(priceLists.effectiveDate, effectiveDate)
        )
      )
      .orderBy(desc(priceLists.effectiveDate))
      .limit(1)

    if (!activePriceListQuery[0]) {
      return null
    }

    const activePriceList = activePriceListQuery[0]

    // Get price list item for the SKU with tier pricing
    const priceItemQuery = await db
      .select({
        id: priceListItems.id,
        sku: priceListItems.sku,
        description: priceListItems.description,
        unitPrice: priceListItems.unitPrice,
        currency: priceListItems.currency,
        minQuantity: priceListItems.minQuantity,
        discountPercent: priceListItems.discountPercent,
        tierPricing: priceListItems.tierPricing
      })
      .from(priceListItems)
      .where(
        and(
          eq(priceListItems.priceListId, activePriceList.id),
          eq(priceListItems.sku, sku)
        )
      )
      .limit(1)

    if (!priceItemQuery[0]) {
      return null
    }

    const priceItem = priceItemQuery[0]

    // Validate minimum quantity requirement
    if (validateMinQuantity && quantity < priceItem.minQuantity) {
      return {
        error: 'MINIMUM_QUANTITY_NOT_MET',
        message: `Minimum order quantity is ${priceItem.minQuantity}, requested ${quantity}`,
        minimumQuantity: priceItem.minQuantity,
        requestedQuantity: quantity
      }
    }

    // Calculate tier-based pricing
    const pricingCalculation = calculateTierPricing(priceItem, quantity, includeAllTiers)

    // Apply currency conversion if needed
    const finalCurrency = currency || priceItem.currency || activePriceList.currency
    const conversionRate = await getCurrencyConversionRate(priceItem.currency, finalCurrency)

    const result = {
      // Basic information
      sku: priceItem.sku,
      description: priceItem.description,
      supplierId,
      supplierName: activePriceList.supplierName,
      
      // Price list information
      priceListId: activePriceList.id,
      priceListName: activePriceList.name,
      effectiveDate: activePriceList.effectiveDate,
      expiryDate: activePriceList.expiryDate,
      
      // Pricing information
      baseCurrency: priceItem.currency,
      requestedCurrency: finalCurrency,
      conversionRate,
      baseUnitPrice: priceItem.unitPrice,
      convertedUnitPrice: priceItem.unitPrice * conversionRate,
      
      // Quantity and tier information
      requestedQuantity: quantity,
      minimumQuantity: priceItem.minQuantity,
      
      // Applied pricing
      appliedTier: pricingCalculation.appliedTier,
      appliedUnitPrice: pricingCalculation.appliedPrice * conversionRate,
      appliedDiscount: pricingCalculation.discountPercent,
      
      // Totals
      lineTotal: pricingCalculation.appliedPrice * conversionRate * quantity,
      totalSavings: (priceItem.unitPrice - pricingCalculation.appliedPrice) * conversionRate * quantity,
      savingsPercent: pricingCalculation.discountPercent,
      
      // Additional information
      allTiers: includeAllTiers ? pricingCalculation.allTiers : undefined,
      calculatedAt: new Date(),
      
      // Business rules applied
      businessRules: {
        minimumQuantityValidated: validateMinQuantity,
        currencyConverted: priceItem.currency !== finalCurrency,
        tierPricingApplied: pricingCalculation.tierApplied,
        discountApplied: pricingCalculation.discountPercent > 0
      }
    }

    return result

  } catch (error) {
    throw new Error(`Failed to get supplier price: ${error.message}`)
  }
}

/**
 * Calculate tier-based pricing for a price item
 */
function calculateTierPricing(priceItem, quantity, includeAllTiers = false) {
  const { unitPrice, tierPricing, discountPercent } = priceItem
  
  let appliedPrice = unitPrice
  let appliedTier = null
  let tierApplied = false
  let finalDiscountPercent = discountPercent || 0

  // Process tier pricing if available
  if (tierPricing && Array.isArray(tierPricing) && tierPricing.length > 0) {
    // Sort tiers by minQuantity descending to find the highest applicable tier
    const sortedTiers = [...tierPricing].sort((a, b) => b.minQuantity - a.minQuantity)
    
    // Find the best applicable tier
    for (const tier of sortedTiers) {
      if (quantity >= tier.minQuantity) {
        appliedPrice = tier.price || tier.unitPrice || unitPrice
        appliedTier = {
          minQuantity: tier.minQuantity,
          price: appliedPrice,
          discount: tier.discount || tier.discountPercent || 0
        }
        finalDiscountPercent = tier.discount || tier.discountPercent || 0
        tierApplied = true
        break
      }
    }
  }

  // If no tier pricing applied but base discount exists
  if (!tierApplied && discountPercent > 0) {
    appliedPrice = unitPrice * (1 - discountPercent / 100)
    finalDiscountPercent = discountPercent
  }

  const result = {
    appliedPrice,
    appliedTier,
    tierApplied,
    discountPercent: finalDiscountPercent
  }

  // Include all tiers if requested
  if (includeAllTiers && tierPricing && Array.isArray(tierPricing)) {
    result.allTiers = tierPricing.map(tier => ({
      minQuantity: tier.minQuantity,
      price: tier.price || tier.unitPrice || unitPrice,
      discount: tier.discount || tier.discountPercent || 0,
      applicable: quantity >= tier.minQuantity,
      totalForMinQuantity: (tier.price || tier.unitPrice || unitPrice) * tier.minQuantity,
      savingsVsBase: unitPrice - (tier.price || tier.unitPrice || unitPrice)
    })).sort((a, b) => a.minQuantity - b.minQuantity)
  }

  return result
}

/**
 * Get currency conversion rate (placeholder implementation)
 */
async function getCurrencyConversionRate(fromCurrency, toCurrency) {
  if (fromCurrency === toCurrency) return 1

  // In production, this would call a real currency conversion service
  const exchangeRates = {
    'USD': { 'EUR': 0.85, 'GBP': 0.73, 'ZAR': 18.5 },
    'EUR': { 'USD': 1.18, 'GBP': 0.86, 'ZAR': 21.8 },
    'GBP': { 'USD': 1.37, 'EUR': 1.16, 'ZAR': 25.3 },
    'ZAR': { 'USD': 0.054, 'EUR': 0.046, 'GBP': 0.040 }
  }

  return exchangeRates[fromCurrency]?.[toCurrency] || 1
}

// ==================== PRICE LIST ACTIVATION WITH VALIDATION ====================

/**
 * Activate price list with comprehensive validation and business rule enforcement
 */
export async function activatePriceListEnhanced(priceListId, userId, options = {}) {
  const {
    effectiveDate = new Date(),
    validatePrices = true,
    checkConflicts = true,
    deactivateOthers = true,
    bypassApproval = false
  } = options

  return await db.transaction(async (tx) => {
    // Get the price list to activate
    const priceListQuery = await tx
      .select({
        id: priceLists.id,
        supplierId: priceLists.supplierId,
        name: priceLists.name,
        status: priceLists.status,
        effectiveDate: priceLists.effectiveDate,
        expiryDate: priceLists.expiryDate,
        supplierName: suppliers.companyName
      })
      .from(priceLists)
      .innerJoin(suppliers, eq(priceLists.supplierId, suppliers.id))
      .where(eq(priceLists.id, priceListId))
      .limit(1)

    if (!priceListQuery[0]) {
      throw new Error('Price list not found')
    }

    const priceList = priceListQuery[0]

    // Business rule: Only approved price lists can be activated (unless bypassed)
    if (!bypassApproval && priceList.status !== 'approved') {
      throw new Error(`Price list must be approved before activation. Current status: ${priceList.status}`)
    }

    // Business rule: Cannot activate expired price lists
    if (priceList.expiryDate && new Date(priceList.expiryDate) < effectiveDate) {
      throw new Error(`Price list expired on ${priceList.expiryDate}. Cannot activate expired price lists.`)
    }

    // Validate prices if requested
    if (validatePrices) {
      const priceValidation = await validatePriceListPricesEnhanced(priceListId, tx)
      if (!priceValidation.valid) {
        throw new Error(`Price validation failed: ${priceValidation.errors.join(', ')}`)
      }
    }

    // Check for conflicts with existing active price lists
    if (checkConflicts) {
      const conflicts = await checkPriceListConflictsEnhanced(priceList.supplierId, priceListId, tx)
      if (conflicts.hasConflicts && !deactivateOthers) {
        throw new Error(`Price list conflicts with ${conflicts.conflictCount} existing active price lists`)
      }
    }

    // Deactivate other active price lists for this supplier if requested
    if (deactivateOthers) {
      await tx
        .update(priceLists)
        .set({
          status: 'archived',
          updatedAt: new Date()
        })
        .where(
          and(
            eq(priceLists.supplierId, priceList.supplierId),
            eq(priceLists.status, 'active')
          )
        )
    }

    // Activate the selected price list
    const activatedPriceList = await tx
      .update(priceLists)
      .set({
        status: 'active',
        effectiveDate: effectiveDate,
        updatedAt: new Date()
      })
      .where(eq(priceLists.id, priceListId))
      .returning()

    // Create activation audit record (if audit table exists)
    const activationRecord = {
      priceListId,
      supplierId: priceList.supplierId,
      activatedBy: userId,
      activatedAt: new Date(),
      effectiveDate,
      options
    }

    return {
      priceList: activatedPriceList[0],
      activation: activationRecord,
      message: `Price list "${priceList.name}" activated successfully for ${priceList.supplierName}`
    }
  })
}

/**
 * Validate price list prices with enhanced business rules
 */
async function validatePriceListPricesEnhanced(priceListId, tx) {
  const items = await tx
    .select()
    .from(priceListItems)
    .where(eq(priceListItems.priceListId, priceListId))

  const errors = []
  const warnings = []

  for (const item of items) {
    // Check for zero or negative prices
    if (item.unitPrice <= 0) {
      errors.push(`SKU ${item.sku}: Invalid unit price (${item.unitPrice})`)
    }

    // Check minimum quantity
    if (item.minQuantity < 1) {
      errors.push(`SKU ${item.sku}: Minimum quantity must be at least 1`)
    }

    // Validate tier pricing
    if (item.tierPricing && Array.isArray(item.tierPricing)) {
      for (let i = 0; i < item.tierPricing.length; i++) {
        const tier = item.tierPricing[i]
        
        if (!tier.minQuantity || tier.minQuantity <= 0) {
          errors.push(`SKU ${item.sku}: Tier ${i + 1} has invalid minimum quantity`)
        }
        
        if (!tier.price || tier.price <= 0) {
          errors.push(`SKU ${item.sku}: Tier ${i + 1} has invalid price`)
        }
        
        // Check that tier prices are lower than base price
        if (tier.price >= item.unitPrice) {
          warnings.push(`SKU ${item.sku}: Tier ${i + 1} price (${tier.price}) is not lower than base price (${item.unitPrice})`)
        }
        
        // Check tier ordering
        if (i > 0 && tier.minQuantity <= item.tierPricing[i - 1].minQuantity) {
          errors.push(`SKU ${item.sku}: Tier ${i + 1} minimum quantity must be greater than previous tier`)
        }
      }
    }

    // Check for extremely high prices (potential data entry errors)
    if (item.unitPrice > 100000) {
      warnings.push(`SKU ${item.sku}: Unusually high price (${item.unitPrice})`)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    itemCount: items.length
  }
}

/**
 * Check for conflicts with existing active price lists
 */
async function checkPriceListConflictsEnhanced(supplierId, excludePriceListId, tx) {
  const activeListsQuery = await tx
    .select({
      id: priceLists.id,
      name: priceLists.name,
      effectiveDate: priceLists.effectiveDate,
      expiryDate: priceLists.expiryDate
    })
    .from(priceLists)
    .where(
      and(
        eq(priceLists.supplierId, supplierId),
        eq(priceLists.status, 'active'),
        sql`${priceLists.id} != ${excludePriceListId}`
      )
    )

  return {
    hasConflicts: activeListsQuery.length > 0,
    conflictCount: activeListsQuery.length,
    conflictingPriceLists: activeListsQuery
  }
}

// ==================== BULK PRICE OPERATIONS ====================

/**
 * Get bulk supplier prices with enhanced tier calculations
 */
export async function getBulkSupplierPricesEnhanced(supplierId, items, options = {}) {
  const {
    currency = 'USD',
    validateQuantities = true,
    includeAlternatives = false,
    optimizeQuantities = false
  } = options

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Items array is required and must not be empty')
  }

  const skus = items.map(item => item.sku)
  const results = []
  const notFound = []
  const errors = []

  // Get prices for all SKUs
  for (const item of items) {
    try {
      const priceResult = await getSupplierPriceEnhanced(
        supplierId, 
        item.sku, 
        item.quantity || 1, 
        { 
          currency, 
          includeAllTiers: optimizeQuantities,
          validateMinQuantity: validateQuantities 
        }
      )

      if (priceResult) {
        if (priceResult.error) {
          errors.push({
            sku: item.sku,
            error: priceResult.error,
            message: priceResult.message
          })
        } else {
          results.push({
            ...priceResult,
            requestedQuantity: item.quantity || 1,
            originalRequest: item
          })
        }
      } else {
        notFound.push(item.sku)
      }
    } catch (error) {
      errors.push({
        sku: item.sku,
        error: 'PROCESSING_ERROR',
        message: error.message
      })
    }
  }

  // Calculate totals
  const orderTotal = results.reduce((acc, price) => acc + price.lineTotal, 0)
  const totalSavings = results.reduce((acc, price) => acc + price.totalSavings, 0)
  const averageDiscount = results.length > 0 
    ? results.reduce((acc, price) => acc + price.savingsPercent, 0) / results.length 
    : 0

  return {
    success: true,
    data: {
      prices: results,
      notFound,
      errors,
      summary: {
        totalItems: items.length,
        foundItems: results.length,
        notFoundCount: notFound.length,
        errorCount: errors.length,
        orderTotal,
        totalSavings,
        averageDiscount,
        currency,
        calculatedAt: new Date()
      }
    }
  }
}

/**
 * Suggest quantity optimizations based on tier pricing
 */
export async function suggestQuantityOptimization(supplierId, items, options = {}) {
  const {
    maxBudget = null,
    targetSavingsPercent = 10,
    includeAlternativeQuantities = true
  } = options

  const suggestions = []

  for (const item of items) {
    const priceResult = await getSupplierPriceEnhanced(
      supplierId,
      item.sku,
      item.quantity || 1,
      { includeAllTiers: true }
    )

    if (priceResult && priceResult.allTiers) {
      const currentTotal = priceResult.lineTotal
      const optimizations = []

      // Find better tier options
      for (const tier of priceResult.allTiers) {
        if (tier.minQuantity > item.quantity) {
          const tierTotal = tier.price * tier.minQuantity
          const savingsPerUnit = priceResult.appliedUnitPrice - tier.price
          const totalSavings = savingsPerUnit * tier.minQuantity
          const savingsPercent = (totalSavings / tierTotal) * 100

          if (savingsPercent >= targetSavingsPercent) {
            optimizations.push({
              suggestedQuantity: tier.minQuantity,
              unitPrice: tier.price,
              lineTotal: tierTotal,
              savingsPerUnit,
              totalSavings,
              savingsPercent,
              additionalQuantity: tier.minQuantity - item.quantity,
              additionalInvestment: tierTotal - currentTotal
            })
          }
        }
      }

      if (optimizations.length > 0) {
        suggestions.push({
          sku: item.sku,
          currentQuantity: item.quantity,
          currentTotal: currentTotal,
          optimizations: optimizations.sort((a, b) => b.savingsPercent - a.savingsPercent)
        })
      }
    }
  }

  return suggestions
}

export {
  getSupplierPriceEnhanced,
  activatePriceListEnhanced,
  getBulkSupplierPricesEnhanced,
  suggestQuantityOptimization
}