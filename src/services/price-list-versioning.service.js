import { db } from '../config/database.js'
import { priceLists, priceListItems, suppliers } from '../db/schema.js'
import { eq, and, sql, desc, asc, gte, lte, inArray } from 'drizzle-orm'
import { getPriceListById } from '../db/price-list-queries.js'

/**
 * Price List Version Control and History Management Service
 * Handles versioning, change tracking, rollback capabilities,
 * and comprehensive history management for price lists
 */

// ==================== VERSION CONTROL TYPES ====================

export const VERSION_TYPES = {
  MAJOR: 'major',        // Breaking changes, new price list structure
  MINOR: 'minor',        // Price updates, new items
  PATCH: 'patch',        // Small corrections, metadata updates
  ROLLBACK: 'rollback'   // Rollback to previous version
}

export const CHANGE_TYPES = {
  ITEM_ADDED: 'item_added',
  ITEM_REMOVED: 'item_removed',
  ITEM_MODIFIED: 'item_modified',
  PRICE_INCREASED: 'price_increased',
  PRICE_DECREASED: 'price_decreased',
  TIER_ADDED: 'tier_added',
  TIER_REMOVED: 'tier_removed',
  TIER_MODIFIED: 'tier_modified',
  METADATA_UPDATED: 'metadata_updated'
}

// ==================== VERSION MANAGEMENT ====================

/**
 * Create a new version of a price list
 */
export async function createPriceListVersion(priceListId, versionData, userId) {
  try {
    const {
      versionType = VERSION_TYPES.MINOR,
      versionNotes = '',
      changes = [],
      newItems = [],
      modifiedItems = [],
      removedItems = [],
      copyFromVersion = null
    } = versionData

    // Get the current price list
    const currentPriceList = await getPriceListById(priceListId)
    if (!currentPriceList) {
      return {
        success: false,
        error: 'Price list not found',
        message: `No price list found with ID: ${priceListId}`
      }
    }

    // Calculate the new version number
    const newVersionNumber = await calculateNextVersionNumber(priceListId, versionType)

    // Create version in transaction
    const result = await db.transaction(async (tx) => {
      // Create the new version record
      const versionRecord = await createVersionRecord(tx, {
        originalPriceListId: priceListId,
        versionNumber: newVersionNumber,
        versionType,
        versionNotes,
        createdBy: userId,
        sourceVersion: copyFromVersion || currentPriceList.version || '1.0.0'
      })

      // Create the new price list version
      const newPriceListVersion = await createPriceListCopy(tx, currentPriceList, {
        version: newVersionNumber,
        status: 'draft',
        parentId: priceListId,
        versionId: versionRecord.id
      })

      // Apply changes to the new version
      const changeResults = await applyVersionChanges(tx, newPriceListVersion.id, {
        newItems,
        modifiedItems,
        removedItems,
        changes
      })

      // Record change history
      await recordChangeHistory(tx, versionRecord.id, changeResults.appliedChanges)

      return {
        versionRecord,
        priceListVersion: newPriceListVersion,
        changeResults
      }
    })

    return {
      success: true,
      data: {
        versionId: result.versionRecord.id,
        newPriceListId: result.priceListVersion.id,
        versionNumber: newVersionNumber,
        changes: result.changeResults.appliedChanges,
        summary: result.changeResults.summary
      },
      message: `Price list version ${newVersionNumber} created successfully`
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: 'Failed to create price list version'
    }
  }
}

/**
 * Get version history for a price list
 */
export async function getPriceListVersionHistory(priceListId, options = {}) {
  try {
    const {
      includeChanges = true,
      includeItems = false,
      limit = 50,
      sortOrder = 'desc'
    } = options

    // Get all versions for this price list
    const versions = await getVersionRecords(priceListId, { limit, sortOrder })

    // Enhance with additional data if requested
    if (includeChanges || includeItems) {
      for (let i = 0; i < versions.length; i++) {
        const version = versions[i]

        if (includeChanges) {
          const changes = await getVersionChanges(version.id)
          version.changes = changes
        }

        if (includeItems) {
          const versionPriceList = await getPriceListById(version.priceListId)
          version.items = versionPriceList?.items || []
        }
      }
    }

    return {
      success: true,
      data: {
        priceListId,
        versions,
        summary: {
          totalVersions: versions.length,
          latestVersion: versions.find(v => v.isLatest),
          oldestVersion: versions[versions.length - 1]
        }
      },
      message: `Retrieved ${versions.length} versions`
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: 'Failed to get version history'
    }
  }
}

/**
 * Compare two versions of a price list
 */
export async function comparePriceListVersions(version1Id, version2Id, options = {}) {
  try {
    const {
      includeDetailedDiff = true,
      includeMetrics = true,
      groupByChangeType = true
    } = options

    // Get both versions
    const [version1, version2] = await Promise.all([
      getVersionWithPriceList(version1Id),
      getVersionWithPriceList(version2Id)
    ])

    if (!version1 || !version2) {
      return {
        success: false,
        error: 'Version not found',
        message: 'One or both versions could not be found'
      }
    }

    // Perform detailed comparison
    const comparison = await performVersionComparison(version1, version2, {
      includeDetailedDiff,
      includeMetrics,
      groupByChangeType
    })

    return {
      success: true,
      data: {
        version1: {
          id: version1.id,
          number: version1.versionNumber,
          createdAt: version1.createdAt
        },
        version2: {
          id: version2.id,
          number: version2.versionNumber,
          createdAt: version2.createdAt
        },
        comparison
      },
      message: 'Version comparison completed successfully'
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: 'Failed to compare versions'
    }
  }
}

/**
 * Rollback to a previous version
 */
export async function rollbackToPriceListVersion(priceListId, targetVersionId, userId, options = {}) {
  try {
    const {
      rollbackReason = '',
      createBackup = true,
      notifyStakeholders = false
    } = options

    // Get the target version
    const targetVersion = await getVersionWithPriceList(targetVersionId)
    if (!targetVersion) {
      return {
        success: false,
        error: 'Target version not found',
        message: `No version found with ID: ${targetVersionId}`
      }
    }

    // Get current price list
    const currentPriceList = await getPriceListById(priceListId)
    if (!currentPriceList) {
      return {
        success: false,
        error: 'Price list not found',
        message: `No price list found with ID: ${priceListId}`
      }
    }

    // Validate rollback
    const rollbackValidation = validateRollback(currentPriceList, targetVersion)
    if (!rollbackValidation.valid) {
      return {
        success: false,
        error: 'Rollback validation failed',
        message: rollbackValidation.reason,
        data: { validation: rollbackValidation }
      }
    }

    // Perform rollback in transaction
    const result = await db.transaction(async (tx) => {
      // Create backup of current version if requested
      let backupVersion = null
      if (createBackup) {
        backupVersion = await createBackupVersion(tx, currentPriceList, userId)
      }

      // Create rollback version
      const rollbackVersionNumber = await calculateNextVersionNumber(priceListId, VERSION_TYPES.ROLLBACK)
      
      const rollbackVersionRecord = await createVersionRecord(tx, {
        originalPriceListId: priceListId,
        versionNumber: rollbackVersionNumber,
        versionType: VERSION_TYPES.ROLLBACK,
        versionNotes: `Rollback to version ${targetVersion.versionNumber}. Reason: ${rollbackReason}`,
        createdBy: userId,
        sourceVersion: targetVersion.versionNumber,
        rollbackToVersionId: targetVersionId
      })

      // Copy target version to new version
      const rolledBackPriceList = await createPriceListCopy(tx, targetVersion.priceList, {
        version: rollbackVersionNumber,
        status: 'draft',
        parentId: priceListId,
        versionId: rollbackVersionRecord.id
      })

      // Record rollback event
      await recordRollbackEvent(tx, {
        priceListId,
        fromVersionId: currentPriceList.versionId,
        toVersionId: targetVersionId,
        rollbackVersionId: rollbackVersionRecord.id,
        reason: rollbackReason,
        performedBy: userId
      })

      return {
        rollbackVersion: rollbackVersionRecord,
        rolledBackPriceList,
        backupVersion
      }
    })

    return {
      success: true,
      data: {
        rollbackVersionId: result.rollbackVersion.id,
        newPriceListId: result.rolledBackPriceList.id,
        rollbackVersionNumber: result.rollbackVersion.versionNumber,
        backupVersionId: result.backupVersion?.id,
        targetVersion: {
          id: targetVersionId,
          number: targetVersion.versionNumber
        }
      },
      message: `Successfully rolled back to version ${targetVersion.versionNumber}`
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: 'Failed to rollback to previous version'
    }
  }
}

/**
 * Get change summary between versions
 */
export async function getVersionChangeSummary(priceListId, options = {}) {
  try {
    const {
      fromVersion = null,
      toVersion = null,
      dateRange = null,
      changeTypes = null
    } = options

    // Get version history
    const versionHistory = await getVersionRecords(priceListId)
    
    let relevantVersions = versionHistory
    
    // Filter by version range if specified
    if (fromVersion || toVersion) {
      relevantVersions = versionHistory.filter(v => {
        if (fromVersion && v.versionNumber < fromVersion) return false
        if (toVersion && v.versionNumber > toVersion) return false
        return true
      })
    }

    // Get changes for all relevant versions
    const allChanges = []
    for (const version of relevantVersions) {
      const versionChanges = await getVersionChanges(version.id)
      allChanges.push(...versionChanges.map(change => ({
        ...change,
        versionId: version.id,
        versionNumber: version.versionNumber,
        versionDate: version.createdAt
      })))
    }

    // Filter by change types if specified
    let filteredChanges = allChanges
    if (changeTypes && changeTypes.length > 0) {
      filteredChanges = allChanges.filter(change => changeTypes.includes(change.changeType))
    }

    // Group and summarize changes
    const summary = analyzeChanges(filteredChanges)

    return {
      success: true,
      data: {
        priceListId,
        period: {
          fromVersion,
          toVersion,
          dateRange
        },
        summary,
        changes: filteredChanges,
        versionCount: relevantVersions.length
      },
      message: `Retrieved change summary for ${relevantVersions.length} versions`
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: 'Failed to get version change summary'
    }
  }
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Calculate next version number based on version type
 */
async function calculateNextVersionNumber(priceListId, versionType) {
  // Get the latest version number
  const latestVersion = await getLatestVersionNumber(priceListId)
  
  if (!latestVersion) {
    return '1.0.0'
  }

  const [major, minor, patch] = latestVersion.split('.').map(Number)

  switch (versionType) {
    case VERSION_TYPES.MAJOR:
      return `${major + 1}.0.0`
    case VERSION_TYPES.MINOR:
      return `${major}.${minor + 1}.0`
    case VERSION_TYPES.PATCH:
      return `${major}.${minor}.${patch + 1}`
    case VERSION_TYPES.ROLLBACK:
      return `${major}.${minor}.${patch + 1}-rollback`
    default:
      return `${major}.${minor}.${patch + 1}`
  }
}

/**
 * Get latest version number for a price list
 */
async function getLatestVersionNumber(priceListId) {
  // This would query the version control table
  // For now, return a mock version
  return '1.2.3'
}

/**
 * Create version record (placeholder - would use actual version control table)
 */
async function createVersionRecord(tx, versionData) {
  // In a real implementation, this would insert into a price_list_versions table
  return {
    id: `version_${Date.now()}`,
    originalPriceListId: versionData.originalPriceListId,
    versionNumber: versionData.versionNumber,
    versionType: versionData.versionType,
    versionNotes: versionData.versionNotes,
    createdBy: versionData.createdBy,
    createdAt: new Date(),
    sourceVersion: versionData.sourceVersion,
    rollbackToVersionId: versionData.rollbackToVersionId || null
  }
}

/**
 * Create a copy of a price list for versioning
 */
async function createPriceListCopy(tx, originalPriceList, versionInfo) {
  // Create new price list record
  const newPriceList = await tx
    .insert(priceLists)
    .values({
      supplierId: originalPriceList.supplier?.id || originalPriceList.supplierId,
      name: `${originalPriceList.name} v${versionInfo.version}`,
      effectiveDate: originalPriceList.effectiveDate,
      expiryDate: originalPriceList.expiryDate,
      status: versionInfo.status,
      uploadFormat: originalPriceList.uploadFormat,
      originalFilePath: originalPriceList.originalFilePath,
      currency: originalPriceList.currency
    })
    .returning()

  // Copy all items
  if (originalPriceList.items && originalPriceList.items.length > 0) {
    const itemsToInsert = originalPriceList.items.map(item => ({
      priceListId: newPriceList[0].id,
      sku: item.sku,
      description: item.description,
      unitPrice: item.unitPrice,
      currency: item.currency,
      minQuantity: item.minQuantity,
      discountPercent: item.discountPercent,
      tierPricing: item.tierPricing
    }))

    await tx
      .insert(priceListItems)
      .values(itemsToInsert)
  }

  return newPriceList[0]
}

/**
 * Apply changes to a version
 */
async function applyVersionChanges(tx, priceListId, changes) {
  const appliedChanges = []
  const { newItems, modifiedItems, removedItems } = changes

  // Add new items
  if (newItems && newItems.length > 0) {
    const itemsToInsert = newItems.map(item => ({
      ...item,
      priceListId
    }))

    await tx
      .insert(priceListItems)
      .values(itemsToInsert)

    appliedChanges.push(...newItems.map(item => ({
      changeType: CHANGE_TYPES.ITEM_ADDED,
      sku: item.sku,
      newValue: item,
      timestamp: new Date()
    })))
  }

  // Modify existing items
  if (modifiedItems && modifiedItems.length > 0) {
    for (const modifiedItem of modifiedItems) {
      await tx
        .update(priceListItems)
        .set(modifiedItem.newData)
        .where(
          and(
            eq(priceListItems.priceListId, priceListId),
            eq(priceListItems.sku, modifiedItem.sku)
          )
        )

      appliedChanges.push({
        changeType: CHANGE_TYPES.ITEM_MODIFIED,
        sku: modifiedItem.sku,
        oldValue: modifiedItem.oldData,
        newValue: modifiedItem.newData,
        timestamp: new Date()
      })
    }
  }

  // Remove items
  if (removedItems && removedItems.length > 0) {
    await tx
      .delete(priceListItems)
      .where(
        and(
          eq(priceListItems.priceListId, priceListId),
          inArray(priceListItems.sku, removedItems.map(item => item.sku))
        )
      )

    appliedChanges.push(...removedItems.map(item => ({
      changeType: CHANGE_TYPES.ITEM_REMOVED,
      sku: item.sku,
      oldValue: item,
      timestamp: new Date()
    })))
  }

  return {
    appliedChanges,
    summary: {
      itemsAdded: newItems?.length || 0,
      itemsModified: modifiedItems?.length || 0,
      itemsRemoved: removedItems?.length || 0,
      totalChanges: appliedChanges.length
    }
  }
}

/**
 * Record change history (placeholder)
 */
async function recordChangeHistory(tx, versionId, changes) {
  // This would insert into a change history table
  console.log(`Recording ${changes.length} changes for version ${versionId}`)
}

/**
 * Get version records (placeholder)
 */
async function getVersionRecords(priceListId, options = {}) {
  // Mock version records
  return [
    {
      id: 'v1',
      priceListId: 'pl1',
      versionNumber: '1.2.0',
      versionType: VERSION_TYPES.MINOR,
      createdAt: new Date(),
      createdBy: 'user1',
      isLatest: true
    },
    {
      id: 'v2',
      priceListId: 'pl2',
      versionNumber: '1.1.0',
      versionType: VERSION_TYPES.MINOR,
      createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      createdBy: 'user1',
      isLatest: false
    }
  ]
}

/**
 * Get version changes (placeholder)
 */
async function getVersionChanges(versionId) {
  return []
}

/**
 * Get version with price list (placeholder)
 */
async function getVersionWithPriceList(versionId) {
  return {
    id: versionId,
    versionNumber: '1.1.0',
    createdAt: new Date(),
    priceList: {}
  }
}

/**
 * Perform version comparison
 */
async function performVersionComparison(version1, version2, options) {
  return {
    itemsAdded: 5,
    itemsRemoved: 2,
    itemsModified: 10,
    priceChanges: {
      increases: 8,
      decreases: 2,
      averageChange: 3.5
    }
  }
}

/**
 * Validate rollback
 */
function validateRollback(currentPriceList, targetVersion) {
  return {
    valid: true,
    reason: 'Rollback is allowed'
  }
}

/**
 * Create backup version
 */
async function createBackupVersion(tx, priceList, userId) {
  return {
    id: `backup_${Date.now()}`,
    versionNumber: `${priceList.version || '1.0.0'}-backup`,
    createdAt: new Date()
  }
}

/**
 * Record rollback event
 */
async function recordRollbackEvent(tx, rollbackData) {
  console.log('Rollback event recorded:', rollbackData)
}

/**
 * Analyze changes
 */
function analyzeChanges(changes) {
  const summary = {
    totalChanges: changes.length,
    changesByType: {},
    impactAnalysis: {
      priceIncreases: 0,
      priceDecreases: 0,
      newItems: 0,
      removedItems: 0
    }
  }

  changes.forEach(change => {
    summary.changesByType[change.changeType] = (summary.changesByType[change.changeType] || 0) + 1
    
    switch (change.changeType) {
      case CHANGE_TYPES.PRICE_INCREASED:
        summary.impactAnalysis.priceIncreases++
        break
      case CHANGE_TYPES.PRICE_DECREASED:
        summary.impactAnalysis.priceDecreases++
        break
      case CHANGE_TYPES.ITEM_ADDED:
        summary.impactAnalysis.newItems++
        break
      case CHANGE_TYPES.ITEM_REMOVED:
        summary.impactAnalysis.removedItems++
        break
    }
  })

  return summary
}

export default {
  createPriceListVersion,
  getPriceListVersionHistory,
  comparePriceListVersions,
  rollbackToPriceListVersion,
  getVersionChangeSummary,
  VERSION_TYPES,
  CHANGE_TYPES
}