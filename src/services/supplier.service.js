import { 
  getSuppliers,
  getSupplierById,
  getSupplierByCode,
  createSupplier,
  updateSupplier,
  deactivateSupplier,
  getSupplierWithPriceLists,
  getSuppliersWithPendingPriceLists,
  bulkUpdateSuppliers,
  supplierExistsByEmail,
  getSupplierStatistics,
  getSupplierWithInventory,
  updateInventoryOnPurchaseReceipt,
  getSupplierLeadTimes,
  getSupplierReorderSuggestions
} from '../db/supplier-queries.js'
import { 
  getPriceLists,
  getPriceListById,
  createPriceList,
  createPriceListItems,
  activatePriceList,
  updatePriceListStatus,
  deletePriceList,
  getSupplierPrice,
  getBulkSupplierPrices,
  getSupplierPriceHistory,
  getPriceListStatistics
} from '../db/price-list-queries.js'
import { parsePriceListFile, validatePriceListFile, standardizePriceListData, validatePriceListData } from '../utils/file-parsers/index.js'
import cacheService from './cache.service.js'

/**
 * Comprehensive Supplier Service Layer
 * Handles all supplier-related business logic including CRUD operations,
 * price list management, performance analytics, and business rules
 */

// ==================== SUPPLIER CRUD OPERATIONS ====================

/**
 * Get suppliers with advanced filtering and search
 */
export async function getSuppliersService(params = {}) {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      isActive = null,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      includeStatistics = false,
      includePriceLists = false
    } = params

    // Generate cache key based on query parameters
    const cacheKey = cacheService.generateKey('suppliers', 'list', JSON.stringify(params))
    
    // Try to get from cache first
    const cached = await cacheService.get(cacheKey)
    if (cached) {
      return {
        success: true,
        data: cached,
        message: `Retrieved ${cached.suppliers.length} suppliers (cached)`,
        fromCache: true
      }
    }

    // Get suppliers with pagination
    const result = await getSuppliers({
      page,
      limit,
      search,
      isActive,
      sortBy,
      sortOrder
    })

    // Enhance with additional data if requested
    if (includeStatistics || includePriceLists) {
      for (let i = 0; i < result.suppliers.length; i++) {
        const supplier = result.suppliers[i]
        
        if (includePriceLists) {
          const supplierWithPriceLists = await getSupplierWithPriceLists(supplier.id)
          result.suppliers[i] = supplierWithPriceLists
        }
        
        if (includeStatistics) {
          // Add performance metrics
          const reorderSuggestions = await getSupplierReorderSuggestions(supplier.id)
          const leadTimes = await getSupplierLeadTimes(supplier.id)
          
          result.suppliers[i].statistics = {
            totalProducts: leadTimes.length,
            itemsNeedingReorder: reorderSuggestions.length,
            averageLeadTime: leadTimes.length > 0 
              ? leadTimes.reduce((acc, lt) => acc + (lt.averageLeadTime || 0), 0) / leadTimes.length 
              : null,
            totalDeliveries: leadTimes.reduce((acc, lt) => acc + (lt.totalDeliveries || 0), 0)
          }
        }
      }
    }

    // Cache the result for 5 minutes
    await cacheService.set(cacheKey, result, 300)

    return {
      success: true,
      data: result,
      message: `Retrieved ${result.suppliers.length} suppliers`
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: 'Failed to retrieve suppliers'
    }
  }
}

/**
 * Get supplier by ID with optional enhancements
 */
export async function getSupplierByIdService(id, options = {}) {
  try {
    const {
      includeInventory = false,
      includePriceLists = false,
      includePerformance = false,
      includeReorderSuggestions = false
    } = options

    // Generate cache key based on options
    const cacheKey = cacheService.generateKey('suppliers', 'detail', id, JSON.stringify(options))
    
    // Try to get from cache first
    const cached = await cacheService.get(cacheKey)
    if (cached) {
      return {
        success: true,
        data: cached,
        message: 'Supplier retrieved successfully (cached)',
        fromCache: true
      }
    }

    let supplier = await getSupplierById(id)
    
    if (!supplier) {
      return {
        success: false,
        error: 'Supplier not found',
        message: `No supplier found with ID: ${id}`
      }
    }

    // Enhance with additional data based on options
    if (includeInventory) {
      const supplierWithInventory = await getSupplierWithInventory(id)
      supplier = supplierWithInventory
    }

    if (includePriceLists) {
      const supplierWithPriceLists = await getSupplierWithPriceLists(id)
      supplier.priceLists = supplierWithPriceLists.priceLists
    }

    if (includePerformance) {
      const leadTimes = await getSupplierLeadTimes(id)
      supplier.performanceMetrics = {
        leadTimeAnalysis: leadTimes,
        averageLeadTime: leadTimes.length > 0 
          ? leadTimes.reduce((acc, lt) => acc + (lt.averageLeadTime || 0), 0) / leadTimes.length 
          : null,
        totalProducts: leadTimes.length,
        totalDeliveries: leadTimes.reduce((acc, lt) => acc + (lt.totalDeliveries || 0), 0)
      }
    }

    if (includeReorderSuggestions) {
      const reorderSuggestions = await getSupplierReorderSuggestions(id)
      supplier.reorderSuggestions = reorderSuggestions
    }

    // Cache the result for 10 minutes
    await cacheService.set(cacheKey, supplier, 600)

    return {
      success: true,
      data: supplier,
      message: 'Supplier retrieved successfully'
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: 'Failed to retrieve supplier'
    }
  }
}

/**
 * Create new supplier with validation
 */
export async function createSupplierService(supplierData, userId) {
  try {
    // Validate required fields
    const requiredFields = ['supplierCode', 'companyName', 'email']
    for (const field of requiredFields) {
      if (!supplierData[field]) {
        return {
          success: false,
          error: `${field} is required`,
          message: 'Validation failed'
        }
      }
    }

    // Check for duplicate email
    const emailExists = await supplierExistsByEmail(supplierData.email)
    if (emailExists) {
      return {
        success: false,
        error: 'Email already exists',
        message: `A supplier with email ${supplierData.email} already exists`
      }
    }

    // Check for duplicate supplier code
    const existingSupplier = await getSupplierByCode(supplierData.supplierCode)
    if (existingSupplier) {
      return {
        success: false,
        error: 'Supplier code already exists',
        message: `A supplier with code ${supplierData.supplierCode} already exists`
      }
    }

    // Set default values
    const supplierToCreate = {
      ...supplierData,
      isActive: supplierData.isActive !== undefined ? supplierData.isActive : true,
      contactDetails: supplierData.contactDetails || {},
      paymentTerms: supplierData.paymentTerms || {},
      createdBy: userId
    }

    const newSupplier = await createSupplier(supplierToCreate)

    return {
      success: true,
      data: newSupplier,
      message: 'Supplier created successfully'
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: 'Failed to create supplier'
    }
  }
}

/**
 * Update supplier with validation
 */
export async function updateSupplierService(id, supplierData, userId) {
  try {
    // Check if supplier exists
    const existingSupplier = await getSupplierById(id)
    if (!existingSupplier) {
      return {
        success: false,
        error: 'Supplier not found',
        message: `No supplier found with ID: ${id}`
      }
    }

    // If email is being updated, check for duplicates
    if (supplierData.email && supplierData.email !== existingSupplier.email) {
      const emailExists = await supplierExistsByEmail(supplierData.email)
      if (emailExists) {
        return {
          success: false,
          error: 'Email already exists',
          message: `A supplier with email ${supplierData.email} already exists`
        }
      }
    }

    // If supplier code is being updated, check for duplicates
    if (supplierData.supplierCode && supplierData.supplierCode !== existingSupplier.supplierCode) {
      const codeExists = await getSupplierByCode(supplierData.supplierCode)
      if (codeExists) {
        return {
          success: false,
          error: 'Supplier code already exists',
          message: `A supplier with code ${supplierData.supplierCode} already exists`
        }
      }
    }

    const updatedSupplier = await updateSupplier(id, {
      ...supplierData,
      updatedBy: userId
    })

    if (!updatedSupplier) {
      return {
        success: false,
        error: 'Update failed',
        message: 'Failed to update supplier'
      }
    }

    return {
      success: true,
      data: updatedSupplier,
      message: 'Supplier updated successfully'
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: 'Failed to update supplier'
    }
  }
}

/**
 * Deactivate supplier (soft delete)
 */
export async function deactivateSupplierService(id, userId, reason = null) {
  try {
    const existingSupplier = await getSupplierById(id)
    if (!existingSupplier) {
      return {
        success: false,
        error: 'Supplier not found',
        message: `No supplier found with ID: ${id}`
      }
    }

    if (!existingSupplier.isActive) {
      return {
        success: false,
        error: 'Supplier already inactive',
        message: 'Supplier is already deactivated'
      }
    }

    // Check for active price lists
    const supplierWithPriceLists = await getSupplierWithPriceLists(id)
    if (supplierWithPriceLists.priceLists && supplierWithPriceLists.priceLists.length > 0) {
      const activePriceLists = supplierWithPriceLists.priceLists.filter(pl => pl.status === 'active')
      if (activePriceLists.length > 0) {
        return {
          success: false,
          error: 'Cannot deactivate supplier with active price lists',
          message: `Supplier has ${activePriceLists.length} active price list(s). Please deactivate them first.`,
          data: { activePriceLists: activePriceLists.length }
        }
      }
    }

    const deactivatedSupplier = await deactivateSupplier(id)
    
    // Log deactivation reason if provided
    if (reason && deactivatedSupplier) {
      // Could implement audit logging here
      console.log(`Supplier ${id} deactivated by ${userId}. Reason: ${reason}`)
    }

    return {
      success: true,
      data: deactivatedSupplier,
      message: 'Supplier deactivated successfully'
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: 'Failed to deactivate supplier'
    }
  }
}

// ==================== SUPPLIER ANALYTICS & PERFORMANCE ====================

/**
 * Get comprehensive supplier performance metrics
 */
export async function getSupplierPerformanceService(supplierId, options = {}) {
  try {
    const {
      dateFrom = null,
      dateTo = null,
      includeProducts = true,
      includeLeadTimes = true,
      includeReorderSuggestions = true
    } = options

    const supplier = await getSupplierById(supplierId)
    if (!supplier) {
      return {
        success: false,
        error: 'Supplier not found',
        message: `No supplier found with ID: ${supplierId}`
      }
    }

    const performance = {
      supplier: {
        id: supplier.id,
        code: supplier.supplierCode,
        name: supplier.companyName
      },
      period: {
        from: dateFrom,
        to: dateTo
      }
    }

    // Get lead time analysis
    if (includeLeadTimes) {
      const leadTimes = await getSupplierLeadTimes(supplierId, { dateFrom, dateTo })
      
      performance.leadTimeMetrics = {
        totalProducts: leadTimes.length,
        totalDeliveries: leadTimes.reduce((acc, lt) => acc + (lt.totalDeliveries || 0), 0),
        averageLeadTime: leadTimes.length > 0 
          ? leadTimes.reduce((acc, lt) => acc + (lt.averageLeadTime || 0), 0) / leadTimes.length 
          : null,
        minLeadTime: Math.min(...leadTimes.map(lt => lt.minLeadTime || Infinity).filter(v => v !== Infinity)),
        maxLeadTime: Math.max(...leadTimes.map(lt => lt.maxLeadTime || 0)),
        productBreakdown: leadTimes
      }
    }

    // Get reorder analysis
    if (includeReorderSuggestions) {
      const reorderSuggestions = await getSupplierReorderSuggestions(supplierId)
      
      performance.inventoryMetrics = {
        totalProductsManaged: reorderSuggestions.length,
        itemsNeedingReorder: reorderSuggestions.filter(r => r.needsReorder).length,
        totalValueAtRisk: reorderSuggestions.reduce((acc, r) => 
          acc + (r.needsReorder ? (r.totalReorderQuantity * r.lastPurchaseCost) : 0), 0
        ),
        reorderSuggestions
      }
    }

    // Get price list statistics
    const priceListStats = await getPriceListStatistics(supplierId)
    performance.priceListMetrics = priceListStats

    // Calculate overall performance score
    performance.overallScore = calculateSupplierPerformanceScore(performance)

    return {
      success: true,
      data: performance,
      message: 'Supplier performance metrics retrieved successfully'
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: 'Failed to retrieve supplier performance metrics'
    }
  }
}

/**
 * Calculate supplier performance score (0-100)
 */
function calculateSupplierPerformanceScore(performance) {
  let score = 100
  let factors = []

  // Lead time performance (40% weight)
  if (performance.leadTimeMetrics) {
    const avgLeadTime = performance.leadTimeMetrics.averageLeadTime
    if (avgLeadTime !== null) {
      let leadTimeScore = 100
      if (avgLeadTime > 30) leadTimeScore = 60
      else if (avgLeadTime > 21) leadTimeScore = 75
      else if (avgLeadTime > 14) leadTimeScore = 85
      else if (avgLeadTime > 7) leadTimeScore = 95
      
      factors.push({ factor: 'leadTime', score: leadTimeScore, weight: 0.4 })
    }
  }

  // Inventory management (30% weight)
  if (performance.inventoryMetrics) {
    const reorderRatio = performance.inventoryMetrics.totalProductsManaged > 0 
      ? performance.inventoryMetrics.itemsNeedingReorder / performance.inventoryMetrics.totalProductsManaged 
      : 0
    
    let inventoryScore = 100
    if (reorderRatio > 0.3) inventoryScore = 50
    else if (reorderRatio > 0.2) inventoryScore = 70
    else if (reorderRatio > 0.1) inventoryScore = 85
    else if (reorderRatio > 0.05) inventoryScore = 95
    
    factors.push({ factor: 'inventory', score: inventoryScore, weight: 0.3 })
  }

  // Price list management (30% weight)
  if (performance.priceListMetrics) {
    const activeLists = performance.priceListMetrics.activePriceLists || 0
    const pendingLists = performance.priceListMetrics.pendingPriceLists || 0
    
    let priceListScore = 100
    if (activeLists === 0) priceListScore = 40
    else if (pendingLists > 2) priceListScore = 70
    else if (pendingLists > 0) priceListScore = 85
    
    factors.push({ factor: 'priceLists', score: priceListScore, weight: 0.3 })
  }

  // Calculate weighted average
  if (factors.length > 0) {
    const totalWeight = factors.reduce((acc, f) => acc + f.weight, 0)
    score = factors.reduce((acc, f) => acc + (f.score * f.weight), 0) / totalWeight
  }

  return {
    overall: Math.round(score),
    factors: factors.map(f => ({
      name: f.factor,
      score: Math.round(f.score),
      weight: f.weight
    }))
  }
}

// ==================== PURCHASE ORDER INTEGRATION ====================

/**
 * Process purchase order receipt and update inventory
 */
export async function processPurchaseReceiptService(receiptData, userId) {
  try {
    const {
      supplierId,
      purchaseOrderNumber,
      referenceNumber,
      items,
      notes = null,
      deliveryDate = new Date()
    } = receiptData

    // Validate supplier exists
    const supplier = await getSupplierById(supplierId)
    if (!supplier) {
      return {
        success: false,
        error: 'Supplier not found',
        message: `No supplier found with ID: ${supplierId}`
      }
    }

    // Validate items
    if (!items || items.length === 0) {
      return {
        success: false,
        error: 'No items provided',
        message: 'Receipt must contain at least one item'
      }
    }

    // Process receipt
    const movements = await updateInventoryOnPurchaseReceipt({
      supplierId,
      referenceNumber: referenceNumber || purchaseOrderNumber,
      items,
      performedBy: userId,
      notes: notes || `Purchase receipt from ${supplier.companyName}`
    })

    // Calculate totals
    const totalQuantity = items.reduce((acc, item) => acc + item.quantity, 0)
    const totalValue = items.reduce((acc, item) => acc + (item.quantity * item.unitCost), 0)

    return {
      success: true,
      data: {
        supplierId,
        supplier: supplier.companyName,
        referenceNumber: referenceNumber || purchaseOrderNumber,
        totalItems: items.length,
        totalQuantity,
        totalValue,
        movements,
        processedAt: new Date()
      },
      message: `Purchase receipt processed successfully. ${totalQuantity} units received across ${items.length} items.`
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: 'Failed to process purchase receipt'
    }
  }
}

// ==================== BULK OPERATIONS ====================

/**
 * Bulk update suppliers (for migrations)
 */
export async function bulkUpdateSuppliersService(updates, userId) {
  try {
    if (!Array.isArray(updates) || updates.length === 0) {
      return {
        success: false,
        error: 'No updates provided',
        message: 'Updates array is required and must not be empty'
      }
    }

    const results = []
    const errors = []

    for (let i = 0; i < updates.length; i++) {
      const update = updates[i]
      try {
        const result = await updateSupplierService(update.id, update.data, userId)
        if (result.success) {
          results.push(result.data)
        } else {
          errors.push({ index: i, id: update.id, error: result.error })
        }
      } catch (error) {
        errors.push({ index: i, id: update.id, error: error.message })
      }
    }

    return {
      success: errors.length === 0,
      data: {
        updated: results,
        errors,
        summary: {
          total: updates.length,
          successful: results.length,
          failed: errors.length
        }
      },
      message: `Bulk update completed. ${results.length} successful, ${errors.length} failed.`
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: 'Failed to perform bulk update'
    }
  }
}

/**
 * Get system-wide supplier statistics
 */
export async function getSupplierSystemStatisticsService() {
  try {
    const stats = await getSupplierStatistics()
    const pendingSuppliers = await getSuppliersWithPendingPriceLists()
    
    return {
      success: true,
      data: {
        ...stats,
        suppliersWithPendingPriceLists: pendingSuppliers.length,
        systemHealth: {
          activeSupplierRatio: stats.totalSuppliers > 0 
            ? (stats.activeSuppliers / stats.totalSuppliers) 
            : 0,
          priceListCoverageRatio: stats.activeSuppliers > 0 
            ? ((stats.totalPriceLists - stats.pendingPriceLists) / stats.activeSuppliers) 
            : 0
        }
      },
      message: 'System statistics retrieved successfully'
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: 'Failed to retrieve system statistics'
    }
  }
}

export default {
  getSuppliersService,
  getSupplierByIdService,
  createSupplierService,
  updateSupplierService,
  deactivateSupplierService,
  getSupplierPerformanceService,
  processPurchaseReceiptService,
  bulkUpdateSuppliersService,
  getSupplierSystemStatisticsService
}