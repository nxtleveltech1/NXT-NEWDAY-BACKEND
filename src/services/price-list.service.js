import {
  getPriceLists,
  getPriceListById,
  createPriceList,
  createPriceListItems,
  updatePriceListStatus,
  activatePriceList,
  deletePriceList,
  getSupplierPrice,
  getBulkSupplierPrices,
  getSupplierPriceHistory,
  getPriceListStatistics
} from '../db/price-list-queries.js'
import { getSupplierById } from '../db/supplier-queries.js'
import { parsePriceListFile, validatePriceListFile, standardizePriceListData, validatePriceListData } from '../utils/file-parsers/index.js'
import { db } from '../config/database.js'
import { priceLists, priceListItems } from '../db/schema.js'
import { eq, and, sql } from 'drizzle-orm'

/**
 * Enhanced Price List Management Service
 * Handles price list operations, activation workflows, version control,
 * multi-currency support, and business rule enforcement
 */

// ==================== PRICE LIST CRUD OPERATIONS ====================

/**
 * Get price lists with enhanced filtering and business context
 */
export async function getPriceListsService(params = {}) {
  try {
    const {
      page = 1,
      limit = 10,
      supplierId = null,
      status = null,
      includeItems = false,
      includeStatistics = false,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      currency = null,
      effectiveFromDate = null,
      effectiveToDate = null
    } = params

    // Get base price lists
    const result = await getPriceLists({
      page,
      limit,
      supplierId,
      status,
      sortBy,
      sortOrder
    })

    // Enhance with additional data if requested
    if (includeItems || includeStatistics) {
      for (let i = 0; i < result.priceLists.length; i++) {
        const priceListResult = result.priceLists[i]
        const priceListId = priceListResult.priceList.id

        if (includeItems) {
          const fullPriceList = await getPriceListById(priceListId)
          result.priceLists[i].items = fullPriceList.items
        }

        if (includeStatistics) {
          const itemStats = await getPriceListItemStatistics(priceListId)
          result.priceLists[i].statistics = itemStats
        }
      }
    }

    return {
      success: true,
      data: result,
      message: `Retrieved ${result.priceLists.length} price lists`
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: 'Failed to retrieve price lists'
    }
  }
}

/**
 * Get price list by ID with comprehensive details
 */
export async function getPriceListByIdService(id, options = {}) {
  try {
    const {
      includeVersionHistory = false,
      includeValidation = false,
      includeSupplierDetails = true
    } = options

    const priceList = await getPriceListById(id)
    
    if (!priceList) {
      return {
        success: false,
        error: 'Price list not found',
        message: `No price list found with ID: ${id}`
      }
    }

    // Add item statistics
    const itemStats = await getPriceListItemStatistics(id)
    priceList.statistics = itemStats

    // Add version history if requested
    if (includeVersionHistory) {
      const versionHistory = await getPriceListVersionHistory(id)
      priceList.versionHistory = versionHistory
    }

    // Add validation results if requested
    if (includeValidation) {
      const validation = validatePriceListData(priceList, priceList.items)
      priceList.validation = validation
    }

    return {
      success: true,
      data: priceList,
      message: 'Price list retrieved successfully'
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: 'Failed to retrieve price list'
    }
  }
}

/**
 * Process price list file upload with comprehensive validation
 */
export async function uploadPriceListService(fileData, uploadParams, userId) {
  try {
    const {
      supplierId,
      name = null,
      effectiveDate = new Date(),
      expiryDate = null,
      currency = 'USD',
      replaceExisting = false,
      validateOnly = false
    } = uploadParams

    // Validate supplier exists
    const supplier = await getSupplierById(supplierId)
    if (!supplier) {
      return {
        success: false,
        error: 'Supplier not found',
        message: `No supplier found with ID: ${supplierId}`
      }
    }

    // Validate file first
    const fileValidation = await validatePriceListFile(fileData)
    if (!fileValidation.valid) {
      return {
        success: false,
        error: 'File validation failed',
        message: fileValidation.error,
        data: { fileValidation }
      }
    }

    // Parse file
    const parseResult = await parsePriceListFile(fileData)
    if (!parseResult.success) {
      return {
        success: false,
        error: 'File parsing failed',
        message: parseResult.error,
        data: { parseResult }
      }
    }

    // Standardize data
    const standardizedData = standardizePriceListData(parseResult, supplierId, userId)
    
    // Validate standardized data
    const dataValidation = validatePriceListData(standardizedData.priceList, standardizedData.items)
    
    if (validateOnly) {
      return {
        success: true,
        data: {
          validation: dataValidation,
          preview: {
            priceList: standardizedData.priceList,
            itemCount: standardizedData.items.length,
            sampleItems: standardizedData.items.slice(0, 5)
          }
        },
        message: 'Validation completed successfully'
      }
    }

    if (!dataValidation.valid) {
      return {
        success: false,
        error: 'Data validation failed',
        message: 'Price list data contains errors',
        data: { validation: dataValidation }
      }
    }

    // Create price list with transaction
    const result = await db.transaction(async (tx) => {
      // Handle existing price list replacement
      if (replaceExisting) {
        await deactivateExistingPriceLists(supplierId, tx)
      }

      // Create price list
      const priceListData = {
        ...standardizedData.priceList,
        name: name || `${supplier.companyName} - ${new Date().toISOString().split('T')[0]}`,
        effectiveDate,
        expiryDate,
        currency,
        uploadFormat: parseResult.fileType,
        originalFilePath: fileData.filename,
        status: 'draft',
        uploadedBy: userId
      }

      const newPriceList = await tx
        .insert(priceLists)
        .values(priceListData)
        .returning()

      // Create price list items
      const itemsToInsert = standardizedData.items.map(item => ({
        ...item,
        priceListId: newPriceList[0].id,
        currency: item.currency || currency
      }))

      const newItems = await tx
        .insert(priceListItems)
        .values(itemsToInsert)
        .returning()

      return {
        priceList: newPriceList[0],
        items: newItems
      }
    })

    return {
      success: true,
      data: {
        priceList: result.priceList,
        itemCount: result.items.length,
        validation: dataValidation,
        uploadSummary: {
          filename: fileData.filename,
          fileType: parseResult.fileType,
          supplier: supplier.companyName,
          uploadedAt: new Date(),
          uploadedBy: userId
        }
      },
      message: `Price list uploaded successfully. ${result.items.length} items processed.`
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: 'Failed to upload price list'
    }
  }
}

// ==================== PRICE LIST ACTIVATION & WORKFLOW ====================

/**
 * Submit price list for approval with comprehensive validation
 */
export async function submitPriceListForApprovalService(id, userId, submissionNotes = null) {
  try {
    const priceList = await getPriceListById(id)
    
    if (!priceList) {
      return {
        success: false,
        error: 'Price list not found',
        message: `No price list found with ID: ${id}`
      }
    }

    if (priceList.status !== 'draft') {
      return {
        success: false,
        error: 'Invalid status for submission',
        message: `Price list status is ${priceList.status}. Only draft price lists can be submitted for approval.`
      }
    }

    // Validate price list data
    const validation = validatePriceListData(priceList, priceList.items)
    if (!validation.valid) {
      return {
        success: false,
        error: 'Validation failed',
        message: 'Price list contains validation errors and cannot be submitted',
        data: { validation }
      }
    }

    // Check for price change impact
    const priceChangeAnalysis = await analyzePriceChanges(priceList)

    // Update status to pending approval
    const updatedPriceList = await updatePriceListStatus(id, 'pending_approval', userId)

    return {
      success: true,
      data: {
        priceList: updatedPriceList,
        validation,
        priceChangeAnalysis,
        submissionNotes,
        submittedAt: new Date(),
        submittedBy: userId
      },
      message: 'Price list submitted for approval successfully'
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: 'Failed to submit price list for approval'
    }
  }
}

/**
 * Approve price list with authorization check
 */
export async function approvePriceListService(id, approverUserId, approvalNotes = null) {
  try {
    const priceList = await getPriceListById(id)
    
    if (!priceList) {
      return {
        success: false,
        error: 'Price list not found',
        message: `No price list found with ID: ${id}`
      }
    }

    if (priceList.status !== 'pending_approval') {
      return {
        success: false,
        error: 'Invalid status for approval',
        message: `Price list status is ${priceList.status}. Only pending approval price lists can be approved.`
      }
    }

    // Business rule: Cannot approve own submissions (if submitter tracking is implemented)
    // if (priceList.submittedBy === approverUserId) {
    //   return {
    //     success: false,
    //     error: 'Cannot approve own submission',
    //     message: 'Users cannot approve their own price list submissions'
    //   }
    // }

    // Update status to approved
    const approvedPriceList = await updatePriceListStatus(id, 'approved', approverUserId)

    return {
      success: true,
      data: {
        priceList: approvedPriceList,
        approvalNotes,
        approvedAt: new Date(),
        approvedBy: approverUserId
      },
      message: 'Price list approved successfully'
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: 'Failed to approve price list'
    }
  }
}

/**
 * Activate price list with comprehensive business rule validation
 */
export async function activatePriceListService(id, userId, activationOptions = {}) {
  try {
    const {
      effectiveDate = new Date(),
      deactivateOthers = true,
      validatePrices = true,
      notifyStakeholders = false
    } = activationOptions

    const priceList = await getPriceListById(id)
    
    if (!priceList) {
      return {
        success: false,
        error: 'Price list not found',
        message: `No price list found with ID: ${id}`
      }
    }

    // Business rule: Only approved price lists can be activated
    if (priceList.status !== 'approved') {
      return {
        success: false,
        error: 'Price list not approved',
        message: `Price list must be approved before activation. Current status: ${priceList.status}`
      }
    }

    // Business rule: Cannot activate expired price lists
    if (priceList.expiryDate && new Date(priceList.expiryDate) < new Date()) {
      return {
        success: false,
        error: 'Price list expired',
        message: `Price list expired on ${priceList.expiryDate}. Cannot activate expired price lists.`
      }
    }

    // Validate prices if requested
    if (validatePrices) {
      const priceValidation = await validatePriceListPrices(priceList)
      if (!priceValidation.valid) {
        return {
          success: false,
          error: 'Price validation failed',
          message: 'Price list contains invalid pricing data',
          data: { validation: priceValidation }
        }
      }
    }

    // Check for conflicts with existing active price lists
    const conflictAnalysis = await checkPriceListConflicts(priceList)
    if (conflictAnalysis.hasConflicts && !deactivateOthers) {
      return {
        success: false,
        error: 'Activation conflicts detected',
        message: 'Price list conflicts with existing active price lists',
        data: { conflicts: conflictAnalysis }
      }
    }

    // Activate price list using existing query function
    const activatedPriceList = await activatePriceList(id)

    // Create activation audit record
    const activationRecord = {
      priceListId: id,
      activatedBy: userId,
      activatedAt: new Date(),
      effectiveDate,
      previousActivePriceLists: conflictAnalysis.conflictingPriceLists || [],
      options: activationOptions
    }

    return {
      success: true,
      data: {
        priceList: activatedPriceList,
        activation: activationRecord,
        conflicts: conflictAnalysis
      },
      message: 'Price list activated successfully'
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: 'Failed to activate price list'
    }
  }
}

/**
 * Reject price list with reason
 */
export async function rejectPriceListService(id, rejecterUserId, rejectionReason) {
  try {
    const priceList = await getPriceListById(id)
    
    if (!priceList) {
      return {
        success: false,
        error: 'Price list not found',
        message: `No price list found with ID: ${id}`
      }
    }

    if (!['pending_approval', 'draft'].includes(priceList.status)) {
      return {
        success: false,
        error: 'Invalid status for rejection',
        message: `Price list status is ${priceList.status}. Only pending approval or draft price lists can be rejected.`
      }
    }

    if (!rejectionReason || rejectionReason.trim().length === 0) {
      return {
        success: false,
        error: 'Rejection reason required',
        message: 'A rejection reason must be provided'
      }
    }

    // Update status to rejected
    const rejectedPriceList = await updatePriceListStatus(id, 'rejected', rejecterUserId)

    return {
      success: true,
      data: {
        priceList: rejectedPriceList,
        rejectionReason,
        rejectedAt: new Date(),
        rejectedBy: rejecterUserId
      },
      message: 'Price list rejected successfully'
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: 'Failed to reject price list'
    }
  }
}

// ==================== PRICING BUSINESS LOGIC ====================

/**
 * Enhanced get supplier price with tier support and business rules
 */
export async function getSupplierPriceService(supplierId, sku, quantity = 1, options = {}) {
  try {
    const {
      currency = 'USD',
      effectiveDate = new Date(),
      includeHistory = false,
      includeTierBreakdown = false
    } = options

    // Get base price using existing query
    const basePrice = await getSupplierPrice(supplierId, sku, quantity)
    
    if (!basePrice) {
      return {
        success: false,
        error: 'Price not found',
        message: `No active price found for SKU ${sku} from supplier ${supplierId}`
      }
    }

    // Apply business rules
    const enhancedPrice = await applyPricingBusinessRules(basePrice, {
      currency,
      effectiveDate,
      quantity
    })

    // Add tier breakdown if requested
    if (includeTierBreakdown) {
      enhancedPrice.tierBreakdown = await calculateTierBreakdown(supplierId, sku, basePrice.tierPricing)
    }

    // Add price history if requested
    if (includeHistory) {
      enhancedPrice.priceHistory = await getSupplierPriceHistory(supplierId, sku, 10)
    }

    return {
      success: true,
      data: enhancedPrice,
      message: 'Price retrieved successfully'
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: 'Failed to retrieve supplier price'
    }
  }
}

/**
 * Get bulk supplier prices with quantity optimization
 */
export async function getBulkSupplierPricesService(supplierId, items, options = {}) {
  try {
    const {
      currency = 'USD',
      optimizeQuantities = false,
      includeAlternatives = false
    } = options

    if (!Array.isArray(items) || items.length === 0) {
      return {
        success: false,
        error: 'Invalid items array',
        message: 'Items array is required and must not be empty'
      }
    }

    const skus = items.map(item => item.sku)
    const basePrices = await getBulkSupplierPrices(supplierId, skus)

    const enhancedPrices = []
    const notFoundSkus = []

    for (const item of items) {
      const basePrice = basePrices.find(p => p.sku === item.sku)
      
      if (!basePrice) {
        notFoundSkus.push(item.sku)
        continue
      }

      // Calculate price for requested quantity
      const priceResult = await getSupplierPriceService(supplierId, item.sku, item.quantity || 1, options)
      
      if (priceResult.success) {
        enhancedPrices.push({
          ...priceResult.data,
          requestedQuantity: item.quantity || 1,
          lineTotal: priceResult.data.totalPrice
        })
      }
    }

    // Calculate totals
    const orderTotal = enhancedPrices.reduce((acc, price) => acc + price.lineTotal, 0)
    const totalItems = enhancedPrices.length

    return {
      success: true,
      data: {
        prices: enhancedPrices,
        notFound: notFoundSkus,
        summary: {
          totalItems,
          notFoundCount: notFoundSkus.length,
          orderTotal,
          currency,
          calculatedAt: new Date()
        }
      },
      message: `Retrieved prices for ${totalItems} items. ${notFoundSkus.length} items not found.`
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: 'Failed to retrieve bulk supplier prices'
    }
  }
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Get price list item statistics
 */
async function getPriceListItemStatistics(priceListId) {
  const stats = await db
    .select({
      totalItems: sql`count(*)`,
      avgPrice: sql`avg(${priceListItems.unitPrice})`,
      minPrice: sql`min(${priceListItems.unitPrice})`,
      maxPrice: sql`max(${priceListItems.unitPrice})`,
      uniqueCurrencies: sql`count(distinct ${priceListItems.currency})`,
      itemsWithTierPricing: sql`count(*) filter (where ${priceListItems.tierPricing} != '[]'::jsonb)`
    })
    .from(priceListItems)
    .where(eq(priceListItems.priceListId, priceListId))

  return stats[0]
}

/**
 * Analyze price changes compared to previous price list
 */
async function analyzePriceChanges(priceList) {
  // This would compare with the previous active price list for the same supplier
  // Implementation would depend on specific business requirements
  return {
    hasChanges: false,
    priceIncreases: 0,
    priceDecreases: 0,
    newItems: 0,
    removedItems: 0,
    averageChangePercent: 0
  }
}

/**
 * Validate price list prices for business rules
 */
async function validatePriceListPrices(priceList) {
  const errors = []
  const warnings = []

  // Check for zero or negative prices
  const invalidPrices = priceList.items.filter(item => item.unitPrice <= 0)
  if (invalidPrices.length > 0) {
    errors.push(`${invalidPrices.length} items have invalid prices (zero or negative)`)
  }

  // Check for extremely high prices (potential data entry errors)
  const highPrices = priceList.items.filter(item => item.unitPrice > 10000)
  if (highPrices.length > 0) {
    warnings.push(`${highPrices.length} items have unusually high prices (over $10,000)`)
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  }
}

/**
 * Check for conflicts with existing active price lists
 */
async function checkPriceListConflicts(priceList) {
  const existingActiveLists = await getPriceLists({
    supplierId: priceList.supplierId,
    status: 'active'
  })

  return {
    hasConflicts: existingActiveLists.priceLists.length > 0,
    conflictingPriceLists: existingActiveLists.priceLists.map(pl => pl.priceList.id)
  }
}

/**
 * Apply pricing business rules
 */
async function applyPricingBusinessRules(basePrice, options) {
  const { currency, effectiveDate, quantity } = options

  // Apply currency conversion if needed
  let finalPrice = basePrice.unitPrice
  if (basePrice.currency !== currency) {
    finalPrice = await convertCurrency(basePrice.unitPrice, basePrice.currency, currency)
  }

  // Apply quantity discounts
  if (basePrice.tierPricing && basePrice.tierPricing.length > 0) {
    const applicableTier = basePrice.tierPricing
      .filter(tier => quantity >= tier.minQuantity)
      .sort((a, b) => b.minQuantity - a.minQuantity)[0]

    if (applicableTier) {
      finalPrice = applicableTier.price
    }
  }

  return {
    ...basePrice,
    appliedPrice: finalPrice,
    appliedCurrency: currency,
    totalPrice: finalPrice * quantity,
    discountApplied: finalPrice < basePrice.unitPrice,
    discountAmount: basePrice.unitPrice - finalPrice,
    discountPercent: ((basePrice.unitPrice - finalPrice) / basePrice.unitPrice) * 100
  }
}

/**
 * Calculate tier pricing breakdown
 */
async function calculateTierBreakdown(supplierId, sku, tierPricing) {
  if (!tierPricing || tierPricing.length === 0) {
    return []
  }

  return tierPricing.map(tier => ({
    minQuantity: tier.minQuantity,
    price: tier.price,
    savings: tier.discountPercent || 0,
    totalForMinQuantity: tier.price * tier.minQuantity
  }))
}

/**
 * Convert currency (placeholder - would integrate with real currency service)
 */
async function convertCurrency(amount, fromCurrency, toCurrency) {
  // Placeholder implementation - in production, this would call a real currency conversion service
  const exchangeRates = {
    'USD': { 'EUR': 0.85, 'GBP': 0.73, 'ZAR': 18.5 },
    'EUR': { 'USD': 1.18, 'GBP': 0.86, 'ZAR': 21.8 },
    'GBP': { 'USD': 1.37, 'EUR': 1.16, 'ZAR': 25.3 },
    'ZAR': { 'USD': 0.054, 'EUR': 0.046, 'GBP': 0.040 }
  }

  if (fromCurrency === toCurrency) return amount
  
  const rate = exchangeRates[fromCurrency]?.[toCurrency] || 1
  return amount * rate
}

/**
 * Deactivate existing price lists for supplier
 */
async function deactivateExistingPriceLists(supplierId, tx) {
  return await tx
    .update(priceLists)
    .set({
      status: 'archived',
      updatedAt: new Date()
    })
    .where(
      and(
        eq(priceLists.supplierId, supplierId),
        eq(priceLists.status, 'active')
      )
    )
}

/**
 * Get price list version history (placeholder for future implementation)
 */
async function getPriceListVersionHistory(priceListId) {
  // This would implement version tracking
  return []
}

export default {
  getPriceListsService,
  getPriceListByIdService,
  uploadPriceListService,
  submitPriceListForApprovalService,
  approvePriceListService,
  activatePriceListService,
  rejectPriceListService,
  getSupplierPriceService,
  getBulkSupplierPricesService
}