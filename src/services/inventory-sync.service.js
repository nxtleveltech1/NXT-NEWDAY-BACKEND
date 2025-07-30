import { db } from '../config/database.js';
import { inventory, inventoryMovements, products, suppliers, priceLists, priceListItems } from '../db/schema.js';
import { eq, and, sql, inArray, gte } from 'drizzle-orm';
import { realtimeService } from './realtime-service.js';
import { calculateWeightedAverageCost } from './supplier-inventory-integration.service.js';
import { logger } from '../config/logger.js';

/**
 * Inventory Sync Service
 * Handles real-time cost updates, batch processing, and conflict resolution
 */

// ==================== REAL-TIME COST UPDATES ====================

/**
 * Real-time inventory cost update when price lists change
 */
export async function syncInventoryCostsRealtime(priceListId) {
  try {
    // Get price list details
    const priceList = await db
      .select({
        id: priceLists.id,
        supplierId: priceLists.supplierId,
        name: priceLists.name,
        status: priceLists.status
      })
      .from(priceLists)
      .where(eq(priceLists.id, priceListId))
      .limit(1);

    if (!priceList[0] || priceList[0].status !== 'active') {
      logger.warn(`Price list ${priceListId} not found or not active`);
      return { success: false, message: 'Price list not active' };
    }

    // Get all items in the price list
    const priceListItemsData = await db
      .select()
      .from(priceListItems)
      .where(eq(priceListItems.priceListId, priceListId));

    const updates = [];
    const notifications = [];

    // Process each item
    for (const item of priceListItemsData) {
      // Find matching products from this supplier
      const matchingProducts = await db
        .select({ id: products.id })
        .from(products)
        .where(
          and(
            eq(products.sku, item.sku),
            eq(products.supplierId, priceList[0].supplierId)
          )
        );

      for (const product of matchingProducts) {
        // Update inventory costs for each location
        const inventoryUpdates = await db
          .update(inventory)
          .set({
            lastPurchaseCost: item.unitPrice,
            metadata: sql`
              jsonb_set(
                COALESCE(metadata, '{}'::jsonb),
                '{price_sync}',
                ${JSON.stringify({
                  priceListId: priceListId,
                  syncedAt: new Date().toISOString(),
                  unitPrice: item.unitPrice,
                  currency: item.currency,
                  hasTierPricing: !!item.tierPricing
                })}::jsonb
              )
            `,
            updatedAt: new Date()
          })
          .where(eq(inventory.productId, product.id))
          .returning({
            id: inventory.id,
            productId: inventory.productId,
            warehouseId: inventory.warehouseId,
            oldCost: inventory.lastPurchaseCost,
            newCost: sql`${item.unitPrice}`
          });

        updates.push(...inventoryUpdates);

        // Prepare real-time notifications
        for (const update of inventoryUpdates) {
          notifications.push({
            inventoryId: update.id,
            productId: update.productId,
            warehouseId: update.warehouseId,
            priceChange: {
              old: update.oldCost,
              new: item.unitPrice,
              changePercent: update.oldCost ? 
                ((item.unitPrice - update.oldCost) / update.oldCost * 100).toFixed(2) : null
            }
          });
        }
      }
    }

    // Send real-time notifications
    for (const notification of notifications) {
      await realtimeService.notifyInventoryChange({
        ...notification,
        changeReason: 'price_list_sync',
        timestamp: new Date()
      });
    }

    logger.info(`Synced ${updates.length} inventory records for price list ${priceListId}`);

    return {
      success: true,
      priceListId,
      updatedRecords: updates.length,
      notifications: notifications.length
    };
  } catch (error) {
    logger.error('Error in real-time cost sync:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// ==================== BATCH PROCESSING ====================

/**
 * Batch process large inventory updates
 */
export async function batchSyncInventoryCosts(batchData, options = {}) {
  const {
    batchSize = 100,
    parallel = 5,
    conflictResolution = 'latest', // 'latest', 'highest', 'average'
    notifyRealtime = true
  } = options;

  const results = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    conflicts: 0,
    errors: []
  };

  try {
    // Process in batches
    for (let i = 0; i < batchData.length; i += batchSize) {
      const batch = batchData.slice(i, i + batchSize);
      
      // Process batch items in parallel chunks
      const chunks = [];
      for (let j = 0; j < batch.length; j += parallel) {
        chunks.push(batch.slice(j, j + parallel));
      }

      for (const chunk of chunks) {
        const chunkPromises = chunk.map(item => 
          processBatchItem(item, conflictResolution, notifyRealtime)
        );

        const chunkResults = await Promise.allSettled(chunkPromises);

        // Collect results
        chunkResults.forEach((result, index) => {
          results.processed++;
          
          if (result.status === 'fulfilled') {
            if (result.value.success) {
              results.succeeded++;
              if (result.value.hadConflict) {
                results.conflicts++;
              }
            } else {
              results.failed++;
              results.errors.push({
                item: chunk[index],
                error: result.value.error
              });
            }
          } else {
            results.failed++;
            results.errors.push({
              item: chunk[index],
              error: result.reason.message
            });
          }
        });
      }

      // Log progress
      logger.info(`Batch sync progress: ${results.processed}/${batchData.length}`);
    }

    return results;
  } catch (error) {
    logger.error('Batch sync error:', error);
    throw error;
  }
}

/**
 * Process a single batch item
 */
async function processBatchItem(item, conflictResolution, notifyRealtime) {
  return await db.transaction(async (tx) => {
    try {
      // Lock the inventory record
      const current = await tx
        .select()
        .from(inventory)
        .where(eq(inventory.id, item.inventoryId))
        .for('update')
        .limit(1);

      if (!current[0]) {
        return { success: false, error: 'Inventory record not found' };
      }

      // Check for concurrent modification
      const lastUpdated = new Date(current[0].updatedAt);
      const itemTimestamp = new Date(item.timestamp || Date.now());
      
      if (lastUpdated > itemTimestamp && conflictResolution !== 'force') {
        // Handle conflict
        const resolved = await resolveConflict(
          current[0],
          item,
          conflictResolution,
          tx
        );
        
        if (!resolved) {
          return { success: false, error: 'Conflict resolution failed' };
        }
        
        return { success: true, hadConflict: true, resolved };
      }

      // Update inventory
      const updated = await tx
        .update(inventory)
        .set({
          lastPurchaseCost: item.newCost,
          averageCost: item.updateAverageCost ? 
            await calculateWeightedAverageCost(
              item.inventoryId,
              item.quantity || 0,
              item.newCost
            ) : current[0].averageCost,
          metadata: sql`
            jsonb_set(
              COALESCE(metadata, '{}'::jsonb),
              '{batch_sync}',
              ${JSON.stringify({
                batchId: item.batchId,
                syncedAt: new Date().toISOString(),
                source: item.source || 'batch_update'
              })}::jsonb
            )
          `,
          updatedAt: new Date()
        })
        .where(eq(inventory.id, item.inventoryId))
        .returning();

      // Send real-time notification if enabled
      if (notifyRealtime && updated[0]) {
        await realtimeService.notifyInventoryChange({
          inventoryId: updated[0].id,
          productId: updated[0].productId,
          warehouseId: updated[0].warehouseId,
          costChange: {
            old: current[0].lastPurchaseCost,
            new: item.newCost
          },
          changeReason: 'batch_sync'
        });
      }

      return { success: true, updated: updated[0] };
    } catch (error) {
      logger.error(`Error processing batch item ${item.inventoryId}:`, error);
      return { success: false, error: error.message };
    }
  });
}

// ==================== CONFLICT RESOLUTION ====================

/**
 * Resolve conflicts in concurrent updates
 */
async function resolveConflict(current, update, strategy, tx) {
  const conflictData = {
    inventoryId: current.id,
    currentData: {
      lastPurchaseCost: current.lastPurchaseCost,
      averageCost: current.averageCost,
      updatedAt: current.updatedAt
    },
    updateData: {
      lastPurchaseCost: update.newCost,
      timestamp: update.timestamp
    },
    strategy
  };

  let resolvedCost;

  switch (strategy) {
    case 'latest':
      // Use the most recent update
      resolvedCost = new Date(current.updatedAt) > new Date(update.timestamp) ?
        current.lastPurchaseCost : update.newCost;
      break;

    case 'highest':
      // Use the highest cost (conservative)
      resolvedCost = Math.max(
        parseFloat(current.lastPurchaseCost || 0),
        parseFloat(update.newCost || 0)
      );
      break;

    case 'average':
      // Average the conflicting values
      resolvedCost = (
        parseFloat(current.lastPurchaseCost || 0) +
        parseFloat(update.newCost || 0)
      ) / 2;
      break;

    default:
      return null;
  }

  // Apply the resolved value
  const resolved = await tx
    .update(inventory)
    .set({
      lastPurchaseCost: resolvedCost,
      metadata: sql`
        jsonb_set(
          COALESCE(metadata, '{}'::jsonb),
          '{conflict_resolution}',
          ${JSON.stringify({
            resolvedAt: new Date().toISOString(),
            strategy,
            conflictData,
            resolvedValue: resolvedCost
          })}::jsonb
        )
      `,
      updatedAt: new Date()
    })
    .where(eq(inventory.id, current.id))
    .returning();

  // Log conflict resolution
  logger.info(`Resolved conflict for inventory ${current.id} using ${strategy} strategy`);

  return resolved[0];
}

// ==================== SUPPLIER STOCK SYNC ====================

/**
 * Sync inventory levels with supplier stock data
 */
export async function syncSupplierStockLevels(supplierId, stockData, options = {}) {
  const {
    updateLeadTimes = true,
    updateMOQ = true,
    createMissingInventory = false
  } = options;

  const syncResults = {
    updated: 0,
    created: 0,
    failed: 0,
    errors: []
  };

  return await db.transaction(async (tx) => {
    for (const stockItem of stockData) {
      try {
        // Find product by SKU and supplier
        const product = await tx
          .select({ id: products.id, sku: products.sku })
          .from(products)
          .where(
            and(
              eq(products.sku, stockItem.sku),
              eq(products.supplierId, supplierId)
            )
          )
          .limit(1);

        if (!product[0]) {
          syncResults.failed++;
          syncResults.errors.push({
            sku: stockItem.sku,
            error: 'Product not found'
          });
          continue;
        }

        // Get existing inventory records
        const inventoryRecords = await tx
          .select()
          .from(inventory)
          .where(eq(inventory.productId, product[0].id));

        if (inventoryRecords.length === 0 && !createMissingInventory) {
          syncResults.failed++;
          syncResults.errors.push({
            sku: stockItem.sku,
            error: 'No inventory records found'
          });
          continue;
        }

        // Update each inventory location
        for (const inv of inventoryRecords) {
          const updateData = {
            metadata: sql`
              jsonb_set(
                jsonb_set(
                  jsonb_set(
                    COALESCE(metadata, '{}'::jsonb),
                    '{supplier_stock_info}',
                    ${JSON.stringify({
                      availableAtSupplier: stockItem.availableQuantity,
                      onOrderFromSupplier: stockItem.onOrderQuantity || 0,
                      allocatedBySupplier: stockItem.allocatedQuantity || 0,
                      lastSyncedAt: new Date().toISOString()
                    })}::jsonb
                  ),
                  '{supplier_lead_time_days}',
                  ${updateLeadTimes && stockItem.leadTimeDays ? 
                    stockItem.leadTimeDays : 
                    sql`COALESCE(metadata->>'supplier_lead_time_days', '7')`
                  }::text::jsonb
                ),
                '{supplier_moq}',
                ${updateMOQ && stockItem.moq ? 
                  stockItem.moq : 
                  sql`COALESCE(metadata->>'supplier_moq', '1')`
                }::text::jsonb
              )
            `,
            updatedAt: new Date()
          };

          await tx
            .update(inventory)
            .set(updateData)
            .where(eq(inventory.id, inv.id));

          syncResults.updated++;
        }

        // Create inventory record if needed and allowed
        if (inventoryRecords.length === 0 && createMissingInventory && stockItem.warehouseId) {
          const created = await tx
            .insert(inventory)
            .values({
              productId: product[0].id,
              warehouseId: stockItem.warehouseId,
              quantityOnHand: 0,
              quantityAvailable: 0,
              quantityReserved: 0,
              quantityInTransit: 0,
              stockStatus: 'out_of_stock',
              metadata: {
                supplier_stock_info: {
                  availableAtSupplier: stockItem.availableQuantity,
                  onOrderFromSupplier: stockItem.onOrderQuantity || 0,
                  allocatedBySupplier: stockItem.allocatedQuantity || 0,
                  lastSyncedAt: new Date().toISOString()
                },
                supplier_lead_time_days: stockItem.leadTimeDays || 7,
                supplier_moq: stockItem.moq || 1
              }
            })
            .returning();

          syncResults.created++;
        }
      } catch (error) {
        logger.error(`Error syncing stock for SKU ${stockItem.sku}:`, error);
        syncResults.failed++;
        syncResults.errors.push({
          sku: stockItem.sku,
          error: error.message
        });
      }
    }

    return syncResults;
  });
}

// ==================== AUTOMATED SYNC SCHEDULING ====================

/**
 * Schedule automated inventory sync
 */
export class InventorySyncScheduler {
  constructor() {
    this.syncJobs = new Map();
  }

  /**
   * Schedule periodic sync for a supplier
   */
  scheduleSupplierSync(supplierId, intervalMinutes = 60) {
    // Clear existing job if any
    this.clearSupplierSync(supplierId);

    const job = setInterval(async () => {
      try {
        logger.info(`Running scheduled sync for supplier ${supplierId}`);
        
        // Get active price lists for the supplier
        const activePriceLists = await db
          .select({ id: priceLists.id })
          .from(priceLists)
          .where(
            and(
              eq(priceLists.supplierId, supplierId),
              eq(priceLists.status, 'active'),
              eq(priceLists.isActive, true)
            )
          );

        // Sync each active price list
        for (const priceList of activePriceLists) {
          await syncInventoryCostsRealtime(priceList.id);
        }
      } catch (error) {
        logger.error(`Scheduled sync failed for supplier ${supplierId}:`, error);
      }
    }, intervalMinutes * 60 * 1000);

    this.syncJobs.set(supplierId, job);
    logger.info(`Scheduled sync for supplier ${supplierId} every ${intervalMinutes} minutes`);
  }

  /**
   * Clear scheduled sync for a supplier
   */
  clearSupplierSync(supplierId) {
    const job = this.syncJobs.get(supplierId);
    if (job) {
      clearInterval(job);
      this.syncJobs.delete(supplierId);
      logger.info(`Cleared scheduled sync for supplier ${supplierId}`);
    }
  }

  /**
   * Clear all scheduled syncs
   */
  clearAllSyncs() {
    for (const [supplierId, job] of this.syncJobs) {
      clearInterval(job);
    }
    this.syncJobs.clear();
    logger.info('Cleared all scheduled syncs');
  }
}

// ==================== SYNC STATUS MONITORING ====================

/**
 * Get sync status and history
 */
export async function getSyncStatus(options = {}) {
  const {
    supplierId = null,
    limit = 100,
    includeErrors = true
  } = options;

  // Get recent sync activities from inventory metadata
  let query = db
    .select({
      inventoryId: inventory.id,
      productId: inventory.productId,
      productSku: products.sku,
      supplierId: products.supplierId,
      supplierName: suppliers.companyName,
      lastSync: sql`metadata->>'lastSyncedAt'`,
      syncType: sql`
        CASE 
          WHEN metadata->>'batch_sync' IS NOT NULL THEN 'batch'
          WHEN metadata->>'price_sync' IS NOT NULL THEN 'price'
          WHEN metadata->>'supplier_stock_info' IS NOT NULL THEN 'stock'
          ELSE 'unknown'
        END
      `,
      hasConflict: sql`metadata->>'conflict_resolution' IS NOT NULL`
    })
    .from(inventory)
    .innerJoin(products, eq(inventory.productId, products.id))
    .leftJoin(suppliers, eq(products.supplierId, suppliers.id))
    .where(sql`metadata->>'lastSyncedAt' IS NOT NULL`)
    .orderBy(sql`metadata->>'lastSyncedAt' DESC`)
    .limit(limit);

  if (supplierId) {
    query = query.where(eq(products.supplierId, supplierId));
  }

  const syncHistory = await query;

  // Calculate statistics
  const stats = {
    totalSynced: syncHistory.length,
    byType: {
      batch: syncHistory.filter(s => s.syncType === 'batch').length,
      price: syncHistory.filter(s => s.syncType === 'price').length,
      stock: syncHistory.filter(s => s.syncType === 'stock').length
    },
    conflictsResolved: syncHistory.filter(s => s.hasConflict).length,
    lastSyncTime: syncHistory[0]?.lastSync || null
  };

  return {
    stats,
    history: syncHistory
  };
}

// Create singleton instance
export const syncScheduler = new InventorySyncScheduler();