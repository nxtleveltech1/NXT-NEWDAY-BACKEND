import { 
  priceLists, 
  priceListItems, 
  products, 
  suppliers, 
  purchaseOrders,
  timeSeriesEvents,
  timeSeriesMetrics 
} from '../db/schema.js';
import { db } from '../config/database.js';
import { eq, and, sql, inArray, desc, gte, lte } from 'drizzle-orm';
import { sendNotification, createAlert } from './notifications.js';
import { createSupplierPurchaseOrder } from '../db/supplier-purchase-order-queries.js';

/**
 * Price Integration Workflow Service
 * Handles automatic workflows triggered by price list uploads and changes
 */

// ==================== PRICE CHANGE NOTIFICATIONS ====================

/**
 * Process new price list upload and trigger appropriate workflows
 * @param {string} priceListId - The uploaded price list ID
 * @param {string} userId - User who uploaded the price list
 * @returns {Object} Processing results
 */
export async function processNewPriceListWorkflow(priceListId, userId) {
  try {
    // Get price list with items
    const priceListData = await getPriceListWithItems(priceListId);
    
    if (!priceListData) {
      throw new Error('Price list not found');
    }

    const workflowResults = {
      notifications: [],
      alerts: [],
      priceChanges: [],
      automationTriggers: [],
      errors: []
    };

    // 1. Analyze price changes compared to previous price list
    const priceChangeAnalysis = await analyzePriceChanges(priceListData);
    workflowResults.priceChanges = priceChangeAnalysis;

    // 2. Generate notifications based on price changes
    const notifications = await generatePriceChangeNotifications(priceListData, priceChangeAnalysis);
    workflowResults.notifications = notifications;

    // 3. Create alerts for significant price changes
    const alerts = await createPriceChangeAlerts(priceListData, priceChangeAnalysis);
    workflowResults.alerts = alerts;

    // 4. Trigger reorder suggestions if prices dropped significantly
    const reorderSuggestions = await triggerReorderSuggestions(priceListData, priceChangeAnalysis);
    workflowResults.automationTriggers.push(...reorderSuggestions);

    // 5. Log workflow event
    await logWorkflowEvent('price_list_upload_workflow', {
      priceListId,
      supplierId: priceListData.supplierId,
      itemCount: priceListData.items.length,
      userId,
      results: workflowResults
    });

    return {
      success: true,
      data: workflowResults,
      message: 'Price list workflow processed successfully'
    };

  } catch (error) {
    console.error('Error processing price list workflow:', error);
    return {
      success: false,
      error: error.message,
      message: 'Failed to process price list workflow'
    };
  }
}

/**
 * Analyze price changes compared to previous active price list
 * @param {Object} newPriceList - New price list with items
 * @returns {Object} Price change analysis
 */
export async function analyzePriceChanges(newPriceList) {
  try {
    // Get previous active price list for the same supplier
    const [previousPriceList] = await db
      .select()
      .from(priceLists)
      .where(
        and(
          eq(priceLists.supplierId, newPriceList.supplierId),
          eq(priceLists.status, 'active')
        )
      )
      .orderBy(desc(priceLists.effectiveDate))
      .limit(1);

    if (!previousPriceList) {
      return {
        isFirstPriceList: true,
        hasChanges: false,
        newItems: newPriceList.items.length,
        updatedItems: 0,
        removedItems: 0,
        priceIncreases: 0,
        priceDecreases: 0,
        significantChanges: [],
        summary: 'No previous price list to compare'
      };
    }

    // Get previous price list items
    const previousItems = await db
      .select()
      .from(priceListItems)
      .where(eq(priceListItems.priceListId, previousPriceList.id));

    // Create lookup map for previous prices
    const previousPriceMap = new Map();
    previousItems.forEach(item => {
      previousPriceMap.set(item.sku, {
        unitPrice: parseFloat(item.unitPrice),
        currency: item.currency
      });
    });

    const analysis = {
      isFirstPriceList: false,
      hasChanges: false,
      newItems: 0,
      updatedItems: 0,
      removedItems: 0,
      priceIncreases: 0,
      priceDecreases: 0,
      significantChanges: [],
      itemChanges: [],
      previousPriceListId: previousPriceList.id
    };

    // Analyze each item in the new price list
    for (const newItem of newPriceList.items) {
      const previousPrice = previousPriceMap.get(newItem.sku);
      const newPrice = parseFloat(newItem.unitPrice);

      if (!previousPrice) {
        // New item
        analysis.newItems++;
        analysis.itemChanges.push({
          sku: newItem.sku,
          changeType: 'new',
          newPrice,
          description: newItem.description
        });
      } else {
        // Existing item - check for price changes
        const oldPrice = previousPrice.unitPrice;
        const priceDifference = newPrice - oldPrice;
        const changePercent = ((priceDifference / oldPrice) * 100);

        if (Math.abs(priceDifference) > 0.01) { // Significant change
          analysis.hasChanges = true;
          analysis.updatedItems++;

          const changeData = {
            sku: newItem.sku,
            changeType: 'updated',
            oldPrice,
            newPrice,
            priceDifference,
            changePercent: Math.round(changePercent * 100) / 100,
            description: newItem.description
          };

          analysis.itemChanges.push(changeData);

          if (priceDifference > 0) {
            analysis.priceIncreases++;
          } else {
            analysis.priceDecreases++;
          }

          // Flag significant changes (>10% change or >$100 difference)
          if (Math.abs(changePercent) > 10 || Math.abs(priceDifference) > 100) {
            analysis.significantChanges.push(changeData);
          }
        }
      }
    }

    // Check for removed items
    for (const previousItem of previousItems) {
      const stillExists = newPriceList.items.some(item => item.sku === previousItem.sku);
      if (!stillExists) {
        analysis.removedItems++;
        analysis.itemChanges.push({
          sku: previousItem.sku,
          changeType: 'removed',
          oldPrice: parseFloat(previousItem.unitPrice),
          description: previousItem.description
        });
      }
    }

    analysis.summary = `${analysis.newItems} new, ${analysis.updatedItems} updated, ${analysis.removedItems} removed items`;

    return analysis;

  } catch (error) {
    console.error('Error analyzing price changes:', error);
    throw error;
  }
}

/**
 * Generate notifications for price changes
 * @param {Object} priceList - Price list data
 * @param {Object} analysis - Price change analysis
 * @returns {Array} Generated notifications
 */
export async function generatePriceChangeNotifications(priceList, analysis) {
  const notifications = [];

  try {
    // Get supplier info
    const [supplier] = await db
      .select({
        companyName: suppliers.companyName,
        email: suppliers.email
      })
      .from(suppliers)
      .where(eq(suppliers.id, priceList.supplierId));

    if (!supplier) {
      throw new Error('Supplier not found');
    }

    // Notification for new price list upload
    const uploadNotification = {
      type: 'price_list_uploaded',
      title: `New Price List: ${supplier.companyName}`,
      message: `Price list "${priceList.name}" has been uploaded with ${priceList.items.length} items`,
      data: {
        priceListId: priceList.id,
        supplierId: priceList.supplierId,
        supplierName: supplier.companyName,
        itemCount: priceList.items.length
      },
      priority: 'medium',
      category: 'price_management'
    };

    await sendNotification(uploadNotification);
    notifications.push(uploadNotification);

    // Notifications for significant changes
    if (analysis.significantChanges.length > 0) {
      const significantChangesNotification = {
        type: 'significant_price_changes',
        title: `Significant Price Changes: ${supplier.companyName}`,
        message: `${analysis.significantChanges.length} items have significant price changes (>10% or >$100)`,
        data: {
          priceListId: priceList.id,
          supplierId: priceList.supplierId,
          supplierName: supplier.companyName,
          significantChanges: analysis.significantChanges.slice(0, 10) // Limit to first 10
        },
        priority: 'high',
        category: 'price_management'
      };

      await sendNotification(significantChangesNotification);
      notifications.push(significantChangesNotification);
    }

    // Notification for many price decreases (potential cost savings)
    if (analysis.priceDecreases >= 5) {
      const savingsNotification = {
        type: 'potential_cost_savings',
        title: `Potential Cost Savings: ${supplier.companyName}`,
        message: `${analysis.priceDecreases} items have price decreases - consider reordering`,
        data: {
          priceListId: priceList.id,
          supplierId: priceList.supplierId,
          supplierName: supplier.companyName,
          priceDecreases: analysis.priceDecreases
        },
        priority: 'medium',
        category: 'procurement'
      };

      await sendNotification(savingsNotification);
      notifications.push(savingsNotification);
    }

    return notifications;

  } catch (error) {
    console.error('Error generating notifications:', error);
    return notifications;
  }
}

/**
 * Create alerts for significant price changes
 * @param {Object} priceList - Price list data
 * @param {Object} analysis - Price change analysis
 * @returns {Array} Created alerts
 */
export async function createPriceChangeAlerts(priceList, analysis) {
  const alerts = [];

  try {
    // Alert for items with >25% price increase
    const majorIncreases = analysis.itemChanges.filter(
      item => item.changeType === 'updated' && item.changePercent > 25
    );

    if (majorIncreases.length > 0) {
      const alert = {
        type: 'major_price_increase',
        severity: 'high',
        title: 'Major Price Increases Detected',
        message: `${majorIncreases.length} items have price increases over 25%`,
        data: {
          priceListId: priceList.id,
          items: majorIncreases,
          requiresApproval: true
        }
      };

      await createAlert(alert);
      alerts.push(alert);
    }

    // Alert for many new items (potential catalog expansion)
    if (analysis.newItems > 50) {
      const alert = {
        type: 'catalog_expansion',
        severity: 'medium',
        title: 'Large Catalog Addition',
        message: `${analysis.newItems} new items added to supplier catalog`,
        data: {
          priceListId: priceList.id,
          newItemCount: analysis.newItems
        }
      };

      await createAlert(alert);
      alerts.push(alert);
    }

    // Alert for many removed items (potential discontinuation)
    if (analysis.removedItems > 10) {
      const alert = {
        type: 'item_discontinuation',
        severity: 'high',
        title: 'Items Potentially Discontinued',
        message: `${analysis.removedItems} items removed from supplier catalog`,
        data: {
          priceListId: priceList.id,
          removedItemCount: analysis.removedItems,
          requiresReview: true
        }
      };

      await createAlert(alert);
      alerts.push(alert);
    }

    return alerts;

  } catch (error) {
    console.error('Error creating alerts:', error);
    return alerts;
  }
}

// ==================== AUTOMATIC PRODUCT COST UPDATES ====================

/**
 * Automatically update product costs when price list is activated
 * @param {string} priceListId - Activated price list ID
 * @param {Object} options - Update options
 * @returns {Object} Update results
 */
export async function autoUpdateProductCosts(priceListId, options = {}) {
  const {
    updateThreshold = 0.05, // 5% change threshold
    requireApproval = true,
    userId = null
  } = options;

  try {
    // Get price list with items
    const priceListData = await getPriceListWithItems(priceListId);
    
    if (!priceListData || priceListData.status !== 'active') {
      throw new Error('Price list not found or not active');
    }

    const updateResults = {
      updated: 0,
      skipped: 0,
      errors: 0,
      requiresApproval: [],
      updateDetails: []
    };

    // Process each price list item
    for (const item of priceListData.items) {
      try {
        // Find matching product
        const [product] = await db
          .select()
          .from(products)
          .where(
            and(
              eq(products.sku, item.sku),
              eq(products.supplierId, priceListData.supplierId)
            )
          );

        if (!product) {
          updateResults.skipped++;
          updateResults.updateDetails.push({
            sku: item.sku,
            status: 'skipped',
            reason: 'Product not found'
          });
          continue;
        }

        const currentCost = parseFloat(product.costPrice || 0);
        const newCost = parseFloat(item.unitPrice);
        const changePct = currentCost > 0 ? Math.abs((newCost - currentCost) / currentCost) : 1;

        // Check if update is needed
        if (changePct < updateThreshold) {
          updateResults.skipped++;
          updateResults.updateDetails.push({
            sku: item.sku,
            status: 'skipped',
            reason: 'Change below threshold',
            currentCost,
            newCost,
            changePct: Math.round(changePct * 10000) / 100
          });
          continue;
        }

        // Check if requires approval
        if (requireApproval && (changePct > 0.15 || Math.abs(newCost - currentCost) > 100)) {
          updateResults.requiresApproval.push({
            productId: product.id,
            sku: item.sku,
            currentCost,
            newCost,
            changePct: Math.round(changePct * 10000) / 100,
            reason: changePct > 0.15 ? 'Change >15%' : 'Change >$100'
          });
          continue;
        }

        // Update product cost
        await db
          .update(products)
          .set({
            costPrice: newCost.toString(),
            updatedAt: new Date(),
            metadata: sql`${products.metadata} || ${JSON.stringify({
              lastCostUpdate: new Date().toISOString(),
              lastCostSource: 'price_list_automation',
              priceListId: priceListId,
              previousCost: currentCost
            })}`
          })
          .where(eq(products.id, product.id));

        updateResults.updated++;
        updateResults.updateDetails.push({
          sku: item.sku,
          status: 'updated',
          currentCost,
          newCost,
          changePct: Math.round(changePct * 10000) / 100
        });

        // Log the cost update
        await logWorkflowEvent('product_cost_updated', {
          productId: product.id,
          sku: item.sku,
          previousCost: currentCost,
          newCost,
          priceListId,
          userId
        });

      } catch (error) {
        updateResults.errors++;
        updateResults.updateDetails.push({
          sku: item.sku,
          status: 'error',
          error: error.message
        });
        console.error(`Error updating cost for SKU ${item.sku}:`, error);
      }
    }

    // Create summary notification
    if (updateResults.updated > 0 || updateResults.requiresApproval.length > 0) {
      await sendNotification({
        type: 'product_cost_update_summary',
        title: 'Product Cost Update Complete',
        message: `${updateResults.updated} costs updated, ${updateResults.requiresApproval.length} require approval`,
        data: {
          priceListId,
          summary: updateResults,
          timestamp: new Date()
        },
        priority: 'medium',
        category: 'cost_management'
      });
    }

    return {
      success: true,
      data: updateResults,
      message: `Cost update complete: ${updateResults.updated} updated, ${updateResults.requiresApproval.length} require approval`
    };

  } catch (error) {
    console.error('Error auto-updating product costs:', error);
    return {
      success: false,
      error: error.message,
      message: 'Failed to auto-update product costs'
    };
  }
}

// ==================== REORDER AUTOMATION ====================

/**
 * Trigger reorder suggestions based on price changes
 * @param {Object} priceList - Price list data
 * @param {Object} analysis - Price change analysis
 * @returns {Array} Reorder suggestions
 */
export async function triggerReorderSuggestions(priceList, analysis) {
  const suggestions = [];

  try {
    // Find items with significant price decreases (>10% decrease)
    const goodDeals = analysis.itemChanges.filter(
      item => item.changeType === 'updated' && 
               item.changePercent < -10 && 
               item.priceDifference < -5
    );

    for (const deal of goodDeals) {
      // Check current inventory levels
      const [inventory] = await db
        .select({
          quantityOnHand: sql`SUM(${db.schema.inventory.quantityOnHand})`,
          reorderPoint: sql`AVG(${db.schema.inventory.reorderPoint})`,
          reorderQuantity: sql`AVG(${db.schema.inventory.reorderQuantity})`
        })
        .from(db.schema.inventory)
        .innerJoin(products, eq(db.schema.inventory.productId, products.id))
        .where(
          and(
            eq(products.sku, deal.sku),
            eq(products.supplierId, priceList.supplierId)
          )
        );

      if (inventory && inventory.quantityOnHand < inventory.reorderPoint * 2) {
        const suggestion = {
          type: 'price_drop_reorder',
          sku: deal.sku,
          description: deal.description,
          currentInventory: parseInt(inventory.quantityOnHand || 0),
          reorderPoint: parseInt(inventory.reorderPoint || 0),
          suggestedQuantity: parseInt(inventory.reorderQuantity || 0) * 2, // Suggest double due to price drop
          oldPrice: deal.oldPrice,
          newPrice: deal.newPrice,
          savings: deal.priceDifference,
          savingsPercent: Math.abs(deal.changePercent),
          priority: Math.abs(deal.changePercent) > 20 ? 'high' : 'medium'
        };

        suggestions.push(suggestion);
      }
    }

    // Create notification if there are good reorder opportunities
    if (suggestions.length > 0) {
      await sendNotification({
        type: 'reorder_opportunities',
        title: 'Reorder Opportunities Available',
        message: `${suggestions.length} items have price decreases - consider reordering`,
        data: {
          priceListId: priceList.id,
          suggestions: suggestions.slice(0, 5), // Show top 5
          totalOpportunities: suggestions.length
        },
        priority: 'medium',
        category: 'procurement'
      });
    }

    return suggestions;

  } catch (error) {
    console.error('Error generating reorder suggestions:', error);
    return suggestions;
  }
}

// ==================== PRICE CHANGE REPORTS ====================

/**
 * Generate comprehensive price change report
 * @param {string} priceListId - Price list ID
 * @param {Object} options - Report options
 * @returns {Object} Generated report
 */
export async function generatePriceChangeReport(priceListId, options = {}) {
  const {
    includeCharts = true,
    includeDetails = true,
    format = 'json'
  } = options;

  try {
    const priceListData = await getPriceListWithItems(priceListId);
    const analysis = await analyzePriceChanges(priceListData);

    const report = {
      metadata: {
        priceListId,
        supplierName: priceListData.supplierName,
        generatedAt: new Date(),
        reportFormat: format
      },
      summary: {
        totalItems: priceListData.items.length,
        newItems: analysis.newItems,
        updatedItems: analysis.updatedItems,
        removedItems: analysis.removedItems,
        priceIncreases: analysis.priceIncreases,
        priceDecreases: analysis.priceDecreases,
        significantChanges: analysis.significantChanges.length
      },
      analysis,
      recommendations: []
    };

    // Add recommendations based on analysis
    if (analysis.priceDecreases > 5) {
      report.recommendations.push({
        type: 'reorder_opportunity',
        priority: 'medium',
        description: `${analysis.priceDecreases} items have price decreases - consider increasing order quantities`
      });
    }

    if (analysis.significantChanges.length > 0) {
      report.recommendations.push({
        type: 'review_required',
        priority: 'high',
        description: `${analysis.significantChanges.length} items have significant changes - manual review recommended`
      });
    }

    if (analysis.removedItems > 0) {
      report.recommendations.push({
        type: 'discontinuation_review',
        priority: 'high',
        description: `${analysis.removedItems} items removed - check for discontinued products`
      });
    }

    // Include detailed changes if requested
    if (includeDetails) {
      report.detailedChanges = analysis.itemChanges;
    }

    // Generate charts data if requested
    if (includeCharts) {
      report.chartData = {
        changeDistribution: {
          increases: analysis.priceIncreases,
          decreases: analysis.priceDecreases,
          noChange: priceListData.items.length - analysis.updatedItems,
          newItems: analysis.newItems
        },
        significantChanges: analysis.significantChanges.map(change => ({
          sku: change.sku,
          changePercent: change.changePercent,
          priceDifference: change.priceDifference
        }))
      };
    }

    return {
      success: true,
      data: report,
      message: 'Price change report generated successfully'
    };

  } catch (error) {
    console.error('Error generating price change report:', error);
    return {
      success: false,
      error: error.message,
      message: 'Failed to generate price change report'
    };
  }
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Get price list with items and supplier info
 * @param {string} priceListId - Price list ID
 * @returns {Object} Price list data
 */
async function getPriceListWithItems(priceListId) {
  const [priceList] = await db
    .select({
      id: priceLists.id,
      name: priceLists.name,
      supplierId: priceLists.supplierId,
      status: priceLists.status,
      effectiveDate: priceLists.effectiveDate,
      supplierName: suppliers.companyName
    })
    .from(priceLists)
    .innerJoin(suppliers, eq(priceLists.supplierId, suppliers.id))
    .where(eq(priceLists.id, priceListId));

  if (!priceList) return null;

  const items = await db
    .select()
    .from(priceListItems)
    .where(eq(priceListItems.priceListId, priceListId));

  return {
    ...priceList,
    items
  };
}

/**
 * Log workflow events for audit trail
 * @param {string} eventType - Type of event
 * @param {Object} eventData - Event data
 */
async function logWorkflowEvent(eventType, eventData) {
  try {
    await db.insert(timeSeriesEvents).values({
      eventType,
      eventCategory: 'price_workflow',
      action: eventType,
      properties: eventData,
      timestamp: new Date()
    });
  } catch (error) {
    console.error('Error logging workflow event:', error);
  }
}

export default {
  processNewPriceListWorkflow,
  analyzePriceChanges,
  generatePriceChangeNotifications,
  createPriceChangeAlerts,
  autoUpdateProductCosts,
  triggerReorderSuggestions,
  generatePriceChangeReport
};