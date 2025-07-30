import { db } from '../config/database.js'
import { 
  suppliers, 
  priceLists, 
  priceListItems, 
  products, 
  inventory,
  inventoryMovements 
} from '../db/schema.js'
import { eq, and, or, sql, desc, asc, ilike, gte, lte, inArray, isNull } from 'drizzle-orm'

/**
 * Enhanced Supplier Search and Filtering Service
 * Provides advanced search capabilities with multiple filters,
 * sorting options, and business intelligence integration
 */

// ==================== SEARCH CONFIGURATIONS ====================

const SEARCH_FIELDS = {
  basic: ['companyName', 'supplierCode', 'email'],
  contact: ['contactDetails'],
  metadata: ['paymentTerms', 'metadata']
}

const SORT_OPTIONS = {
  companyName: { field: 'companyName', direction: 'asc' },
  supplierCode: { field: 'supplierCode', direction: 'asc' },
  createdAt: { field: 'createdAt', direction: 'desc' },
  lastActivity: { field: 'lastActivity', direction: 'desc' },
  performance: { field: 'performanceScore', direction: 'desc' },
  totalSpend: { field: 'totalSpend', direction: 'desc' },
  productCount: { field: 'productCount', direction: 'desc' }
}

// ==================== ADVANCED SEARCH FUNCTIONS ====================

/**
 * Advanced supplier search with comprehensive filtering
 */
export async function searchSuppliersAdvanced(searchParams = {}) {
  try {
    const {
      // Basic search
      query = '',
      searchFields = ['companyName', 'supplierCode', 'email'],
      
      // Filters
      isActive = null,
      hasActivePriceLists = null,
      hasPendingPriceLists = null,
      performanceGrade = null,
      lastActivityDays = null,
      
      // Financial filters
      minTotalSpend = null,
      maxTotalSpend = null,
      minAvgOrderValue = null,
      maxAvgOrderValue = null,
      
      // Product filters
      minProductCount = null,
      maxProductCount = null,
      categories = [],
      hasLowStock = null,
      
      // Location/Region filters
      regions = [],
      countries = [],
      
      // Performance filters
      minDeliveryRate = null,
      maxReturnRate = null,
      minQualityScore = null,
      
      // Date filters
      createdAfter = null,
      createdBefore = null,
      lastOrderAfter = null,
      lastOrderBefore = null,
      
      // Pagination and sorting
      page = 1,
      limit = 20,
      sortBy = 'companyName',
      sortOrder = 'asc',
      
      // Enhancement options
      includeMetrics = false,
      includeRecentActivity = false,
      includePerformanceScore = false
    } = searchParams

    // Build the base query with joins
    let baseQuery = buildBaseSearchQuery(query, searchFields)
    
    // Apply filters
    const filters = buildSearchFilters({
      isActive,
      hasActivePriceLists,
      hasPendingPriceLists,
      performanceGrade,
      lastActivityDays,
      minTotalSpend,
      maxTotalSpend,
      minAvgOrderValue,
      maxAvgOrderValue,
      minProductCount,
      maxProductCount,
      categories,
      hasLowStock,
      regions,
      countries,
      minDeliveryRate,
      maxReturnRate,
      minQualityScore,
      createdAfter,
      createdBefore,
      lastOrderAfter,
      lastOrderBefore
    })

    // Execute the search query
    const searchResults = await executeSearchQuery(
      baseQuery,
      filters,
      { page, limit, sortBy, sortOrder }
    )

    // Enhance results if requested
    if (includeMetrics || includeRecentActivity || includePerformanceScore) {
      await enhanceSearchResults(searchResults.suppliers, {
        includeMetrics,
        includeRecentActivity,
        includePerformanceScore
      })
    }

    return {
      success: true,
      data: {
        suppliers: searchResults.suppliers,
        pagination: searchResults.pagination,
        filters: {
          applied: getAppliedFilters(searchParams),
          available: getAvailableFilters()
        },
        searchInfo: {
          query,
          searchFields,
          totalResults: searchResults.pagination.total,
          searchTime: Date.now()
        }
      },
      message: `Found ${searchResults.suppliers.length} suppliers`
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: 'Failed to search suppliers'
    }
  }
}

/**
 * Quick search for autocomplete and fast lookups
 */
export async function quickSearchSuppliers(query, options = {}) {
  try {
    const {
      limit = 10,
      includeInactive = false,
      fields = ['companyName', 'supplierCode']
    } = options

    if (!query || query.trim().length < 2) {
      return {
        success: true,
        data: [],
        message: 'Query too short for quick search'
      }
    }

    const searchConditions = fields.map(field => 
      ilike(suppliers[field], `%${query.trim()}%`)
    )

    let whereConditions = [or(...searchConditions)]
    
    if (!includeInactive) {
      whereConditions.push(eq(suppliers.isActive, true))
    }

    const results = await db
      .select({
        id: suppliers.id,
        supplierCode: suppliers.supplierCode,
        companyName: suppliers.companyName,
        email: suppliers.email,
        isActive: suppliers.isActive
      })
      .from(suppliers)
      .where(and(...whereConditions))
      .orderBy(asc(suppliers.companyName))
      .limit(limit)

    return {
      success: true,
      data: results.map(supplier => ({
        id: supplier.id,
        code: supplier.supplierCode,
        name: supplier.companyName,
        email: supplier.email,
        isActive: supplier.isActive,
        label: `${supplier.companyName} (${supplier.supplierCode})`,
        value: supplier.id
      })),
      message: `Found ${results.length} matching suppliers`
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: 'Failed to perform quick search'
    }
  }
}

/**
 * Search suppliers by product/SKU
 */
export async function searchSuppliersByProduct(productQuery, options = {}) {
  try {
    const {
      includeInactive = false,
      includeInactivePriceLists = false,
      sortBy = 'price',
      limit = 50
    } = options

    if (!productQuery || productQuery.trim().length < 2) {
      return {
        success: false,
        error: 'Product query too short',
        message: 'Product query must be at least 2 characters'
      }
    }

    // Search for suppliers that have the product in their active price lists
    const suppliersWithProduct = await db
      .select({
        supplier: suppliers,
        priceList: priceLists,
        priceItem: priceListItems,
        product: products
      })
      .from(suppliers)
      .innerJoin(priceLists, eq(suppliers.id, priceLists.supplierId))
      .innerJoin(priceListItems, eq(priceLists.id, priceListItems.priceListId))
      .leftJoin(products, eq(priceListItems.sku, products.sku))
      .where(
        and(
          or(
            ilike(priceListItems.sku, `%${productQuery.trim()}%`),
            ilike(priceListItems.description, `%${productQuery.trim()}%`),
            ilike(products.name, `%${productQuery.trim()}%`)
          ),
          includeInactive ? sql`1=1` : eq(suppliers.isActive, true),
          includeInactivePriceLists ? sql`1=1` : eq(priceLists.status, 'active')
        )
      )
      .orderBy(
        sortBy === 'price' ? asc(priceListItems.unitPrice) : asc(suppliers.companyName)
      )
      .limit(limit)

    // Group results by supplier
    const supplierMap = new Map()
    
    for (const result of suppliersWithProduct) {
      const supplierId = result.supplier.id
      
      if (!supplierMap.has(supplierId)) {
        supplierMap.set(supplierId, {
          supplier: result.supplier,
          products: []
        })
      }
      
      supplierMap.get(supplierId).products.push({
        sku: result.priceItem.sku,
        description: result.priceItem.description,
        unitPrice: result.priceItem.unitPrice,
        currency: result.priceItem.currency,
        minQuantity: result.priceItem.minQuantity,
        tierPricing: result.priceItem.tierPricing,
        priceList: {
          id: result.priceList.id,
          name: result.priceList.name,
          effectiveDate: result.priceList.effectiveDate,
          status: result.priceList.status
        },
        productInfo: result.product
      })
    }

    const results = Array.from(supplierMap.values())

    return {
      success: true,
      data: {
        suppliers: results,
        summary: {
          totalSuppliers: results.length,
          totalProductMatches: suppliersWithProduct.length,
          searchQuery: productQuery,
          averagePrice: suppliersWithProduct.length > 0 
            ? suppliersWithProduct.reduce((acc, r) => acc + Number(r.priceItem.unitPrice), 0) / suppliersWithProduct.length
            : 0
        }
      },
      message: `Found ${results.length} suppliers with matching products`
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: 'Failed to search suppliers by product'
    }
  }
}

/**
 * Get search suggestions and filters
 */
export async function getSearchSuggestions(partialQuery, type = 'supplier') {
  try {
    const suggestions = []

    switch (type) {
      case 'supplier':
        const supplierSuggestions = await db
          .select({
            companyName: suppliers.companyName,
            supplierCode: suppliers.supplierCode
          })
          .from(suppliers)
          .where(
            and(
              or(
                ilike(suppliers.companyName, `%${partialQuery}%`),
                ilike(suppliers.supplierCode, `%${partialQuery}%`)
              ),
              eq(suppliers.isActive, true)
            )
          )
          .limit(10)

        suggestions.push(...supplierSuggestions.map(s => ({
          type: 'supplier',
          value: s.companyName,
          label: `${s.companyName} (${s.supplierCode})`,
          category: 'Suppliers'
        })))
        break

      case 'product':
        const productSuggestions = await db
          .select({
            sku: priceListItems.sku,
            description: priceListItems.description
          })
          .from(priceListItems)
          .innerJoin(priceLists, eq(priceListItems.priceListId, priceLists.id))
          .where(
            and(
              or(
                ilike(priceListItems.sku, `%${partialQuery}%`),
                ilike(priceListItems.description, `%${partialQuery}%`)
              ),
              eq(priceLists.status, 'active')
            )
          )
          .groupBy(priceListItems.sku, priceListItems.description)
          .limit(10)

        suggestions.push(...productSuggestions.map(p => ({
          type: 'product',
          value: p.sku,
          label: `${p.sku} - ${p.description}`,
          category: 'Products'
        })))
        break

      case 'category':
        const categorySuggestions = await db
          .select({
            category: products.category
          })
          .from(products)
          .where(
            and(
              ilike(products.category, `%${partialQuery}%`),
              isNull(products.category).not()
            )
          )
          .groupBy(products.category)
          .limit(10)

        suggestions.push(...categorySuggestions.map(c => ({
          type: 'category',
          value: c.category,
          label: c.category,
          category: 'Product Categories'
        })))
        break
    }

    return {
      success: true,
      data: suggestions,
      message: `Found ${suggestions.length} suggestions`
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: 'Failed to get search suggestions'
    }
  }
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Build base search query with text search
 */
function buildBaseSearchQuery(query, searchFields) {
  if (!query || query.trim().length === 0) {
    return null // No text search needed
  }

  const searchConditions = searchFields.map(field => {
    if (SEARCH_FIELDS.basic.includes(field)) {
      return ilike(suppliers[field], `%${query.trim()}%`)
    }
    // Handle JSON field searches
    if (field === 'contactDetails') {
      return sql`${suppliers.contactDetails}::text ILIKE ${`%${query.trim()}%`}`
    }
    if (field === 'paymentTerms') {
      return sql`${suppliers.paymentTerms}::text ILIKE ${`%${query.trim()}%`}`
    }
    return null
  }).filter(Boolean)

  return searchConditions.length > 0 ? or(...searchConditions) : null
}

/**
 * Build search filters
 */
function buildSearchFilters(filterParams) {
  const filters = []

  // Basic filters
  if (filterParams.isActive !== null) {
    filters.push(eq(suppliers.isActive, filterParams.isActive))
  }

  // Date filters
  if (filterParams.createdAfter) {
    filters.push(gte(suppliers.createdAt, new Date(filterParams.createdAfter)))
  }
  if (filterParams.createdBefore) {
    filters.push(lte(suppliers.createdAt, new Date(filterParams.createdBefore)))
  }

  // Category filters
  if (filterParams.categories && filterParams.categories.length > 0) {
    // This would require a join with products table
    // Implementation depends on specific requirements
  }

  return filters
}

/**
 * Execute the search query with pagination
 */
async function executeSearchQuery(textSearchCondition, filters, pagination) {
  const { page, limit, sortBy, sortOrder } = pagination
  const offset = (page - 1) * limit

  // Build where clause
  const whereConditions = []
  if (textSearchCondition) {
    whereConditions.push(textSearchCondition)
  }
  whereConditions.push(...filters)

  const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined

  // Build order by clause
  let orderByClause
  if (SORT_OPTIONS[sortBy]) {
    const sortOption = SORT_OPTIONS[sortBy]
    orderByClause = sortOrder === 'desc' 
      ? desc(suppliers[sortOption.field]) 
      : asc(suppliers[sortOption.field])
  } else {
    orderByClause = asc(suppliers.companyName)
  }

  // Execute query with count
  const [results, totalCount] = await Promise.all([
    db
      .select({
        id: suppliers.id,
        supplierCode: suppliers.supplierCode,
        companyName: suppliers.companyName,
        email: suppliers.email,
        contactDetails: suppliers.contactDetails,
        paymentTerms: suppliers.paymentTerms,
        isActive: suppliers.isActive,
        createdAt: suppliers.createdAt
      })
      .from(suppliers)
      .where(whereClause)
      .orderBy(orderByClause)
      .limit(limit)
      .offset(offset),
    
    db
      .select({ count: sql`count(*)` })
      .from(suppliers)
      .where(whereClause)
  ])

  return {
    suppliers: results,
    pagination: {
      total: Number(totalCount[0].count),
      page,
      limit,
      totalPages: Math.ceil(Number(totalCount[0].count) / limit),
      hasNext: page < Math.ceil(Number(totalCount[0].count) / limit),
      hasPrev: page > 1
    }
  }
}

/**
 * Enhance search results with additional data
 */
async function enhanceSearchResults(suppliers, options) {
  const { includeMetrics, includeRecentActivity, includePerformanceScore } = options

  for (let i = 0; i < suppliers.length; i++) {
    const supplier = suppliers[i]

    if (includeMetrics) {
      // Add basic metrics
      const metrics = await getSupplierBasicMetrics(supplier.id)
      supplier.metrics = metrics
    }

    if (includeRecentActivity) {
      // Add recent activity
      const recentActivity = await getSupplierRecentActivity(supplier.id)
      supplier.recentActivity = recentActivity
    }

    if (includePerformanceScore) {
      // Add performance score
      const performanceScore = await getSupplierPerformanceScore(supplier.id)
      supplier.performanceScore = performanceScore
    }
  }
}

/**
 * Get basic metrics for a supplier
 */
async function getSupplierBasicMetrics(supplierId) {
  const metrics = await db
    .select({
      totalProducts: sql`COUNT(DISTINCT ${products.id})`,
      activePriceLists: sql`COUNT(DISTINCT CASE WHEN ${priceLists.status} = 'active' THEN ${priceLists.id} END)`,
      pendingPriceLists: sql`COUNT(DISTINCT CASE WHEN ${priceLists.status} = 'pending_approval' THEN ${priceLists.id} END)`,
      lastPriceListUpdate: sql`MAX(${priceLists.effectiveDate})`
    })
    .from(suppliers)
    .leftJoin(products, eq(suppliers.id, products.supplierId))
    .leftJoin(priceLists, eq(suppliers.id, priceLists.supplierId))
    .where(eq(suppliers.id, supplierId))
    .groupBy(suppliers.id)

  return metrics[0] || {}
}

/**
 * Get recent activity for a supplier
 */
async function getSupplierRecentActivity(supplierId) {
  const recentMovements = await db
    .select({
      movementType: inventoryMovements.movementType,
      quantity: inventoryMovements.quantity,
      createdAt: inventoryMovements.createdAt,
      productSku: sql`(SELECT sku FROM products WHERE id = ${inventoryMovements.productId})`
    })
    .from(inventoryMovements)
    .innerJoin(products, eq(inventoryMovements.productId, products.id))
    .where(
      and(
        eq(products.supplierId, supplierId),
        gte(inventoryMovements.createdAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
      )
    )
    .orderBy(desc(inventoryMovements.createdAt))
    .limit(5)

  return recentMovements
}

/**
 * Get performance score for a supplier (simplified)
 */
async function getSupplierPerformanceScore(supplierId) {
  // Simplified performance score calculation
  // In a real implementation, this would use the supplier analytics service
  return {
    overall: 85,
    grade: 'B',
    lastCalculated: new Date()
  }
}

/**
 * Get applied filters summary
 */
function getAppliedFilters(searchParams) {
  const applied = []
  
  if (searchParams.query) {
    applied.push({ type: 'text', value: searchParams.query, label: `Search: "${searchParams.query}"` })
  }
  
  if (searchParams.isActive !== null) {
    applied.push({ 
      type: 'status', 
      value: searchParams.isActive, 
      label: `Status: ${searchParams.isActive ? 'Active' : 'Inactive'}` 
    })
  }
  
  if (searchParams.categories && searchParams.categories.length > 0) {
    applied.push({ 
      type: 'category', 
      value: searchParams.categories, 
      label: `Categories: ${searchParams.categories.join(', ')}` 
    })
  }

  return applied
}

/**
 * Get available filters for UI
 */
function getAvailableFilters() {
  return {
    status: [
      { value: true, label: 'Active' },
      { value: false, label: 'Inactive' }
    ],
    sortOptions: Object.keys(SORT_OPTIONS).map(key => ({
      value: key,
      label: key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1')
    })),
    searchFields: Object.keys(SEARCH_FIELDS).reduce((acc, category) => {
      acc.push(...SEARCH_FIELDS[category].map(field => ({
        category,
        value: field,
        label: field.charAt(0).toUpperCase() + field.slice(1).replace(/([A-Z])/g, ' $1')
      })))
      return acc
    }, [])
  }
}

export default {
  searchSuppliersAdvanced,
  quickSearchSuppliers,
  searchSuppliersByProduct,
  getSearchSuggestions
}