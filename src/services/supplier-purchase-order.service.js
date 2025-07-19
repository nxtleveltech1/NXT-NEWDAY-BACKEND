import {
  createSupplierPurchaseOrder,
  createPurchaseOrderFromPriceList,
  getSupplierPurchaseOrderById,
  getSupplierPurchaseOrders,
  updateSupplierPurchaseOrderStatus,
  updatePurchaseOrderItemQuantities,
  createPurchaseOrderReceipt,
  processReceiptToInventory,
  getPurchaseOrderAnalytics,
  getPendingApprovals,
  getOrdersReadyForReceiving
} from '../db/supplier-purchase-order-queries.js';
import { getPriceListsBySupplier } from '../db/price-list-queries.js';
import { getInventoryByProductWarehouse } from '../db/inventory-queries.js';
import NotificationService from './notifications.js';
import { EventEmitter } from 'events';

/**
 * Supplier Purchase Order Service
 * Handles business logic for procurement from suppliers
 */
class SupplierPurchaseOrderService extends EventEmitter {
  constructor() {
    super();
    this.notificationService = new NotificationService();
  }

  // ==================== PURCHASE ORDER CREATION ====================

  /**
   * Create a new supplier purchase order
   * @param {Object} orderData - Order data including supplier and items
   * @param {string} userId - User creating the order
   * @returns {Object} Created purchase order
   */
  async createPurchaseOrder(orderData, userId) {
    try {
      // Validate input
      if (!orderData.supplierId) {
        throw new Error('Supplier ID is required');
      }

      if (!orderData.items || orderData.items.length === 0) {
        throw new Error('At least one item is required');
      }

      // Add user context
      const enrichedOrderData = {
        ...orderData,
        createdBy: userId,
        orderDate: new Date()
      };

      // Create the purchase order
      const purchaseOrder = await createSupplierPurchaseOrder(enrichedOrderData, orderData.items);

      // Emit event for integrations
      this.emit('purchaseOrderCreated', {
        purchaseOrder,
        createdBy: userId,
        timestamp: new Date()
      });

      // Send notification if auto-approval is required
      if (purchaseOrder.totalAmount > this.getApprovalThreshold()) {
        await this.notificationService.sendPurchaseOrderApprovalRequest(purchaseOrder);
      }

      return {
        success: true,
        data: purchaseOrder,
        message: 'Purchase order created successfully'
      };
    } catch (error) {
      console.error('Error creating purchase order:', error);
      throw new Error(`Failed to create purchase order: ${error.message}`);
    }
  }

  /**
   * Create purchase order from existing price list
   * @param {string} supplierId - Supplier ID
   * @param {string} priceListId - Price list ID
   * @param {Array} selectedItems - Selected price list items with quantities
   * @param {Object} orderOptions - Additional order options
   * @param {string} userId - User creating the order
   * @returns {Object} Created purchase order
   */
  async createPurchaseOrderFromPriceList(supplierId, priceListId, selectedItems, orderOptions = {}, userId) {
    try {
      if (!selectedItems || selectedItems.length === 0) {
        throw new Error('No items selected from price list');
      }

      // Extract price list item IDs and quantities
      const priceListItemIds = selectedItems.map(item => item.priceListItemId);
      const quantityMap = selectedItems.reduce((map, item) => {
        map[item.priceListItemId] = item.quantity;
        return map;
      }, {});

      // Set default quantities for the order creation
      const enrichedOptions = {
        ...orderOptions,
        quantityMap,
        createdBy: userId,
        defaultQuantity: orderOptions.defaultQuantity || 1
      };

      const purchaseOrder = await createPurchaseOrderFromPriceList(supplierId, priceListItemIds, enrichedOptions);

      // Update item quantities based on selection
      for (const item of purchaseOrder.items) {
        const selectedQuantity = quantityMap[item.priceListItemId];
        if (selectedQuantity && selectedQuantity !== item.quantityOrdered) {
          await updatePurchaseOrderItemQuantities(item.id, {
            quantityOrdered: selectedQuantity
          });
        }
      }

      // Emit event
      this.emit('purchaseOrderCreatedFromPriceList', {
        purchaseOrder,
        priceListId,
        selectedItems,
        createdBy: userId
      });

      return {
        success: true,
        data: purchaseOrder,
        message: 'Purchase order created from price list successfully'
      };
    } catch (error) {
      console.error('Error creating PO from price list:', error);
      throw new Error(`Failed to create purchase order from price list: ${error.message}`);
    }
  }

  // ==================== PURCHASE ORDER MANAGEMENT ====================

  /**
   * Get purchase order by ID with full details
   * @param {string} id - Purchase order ID
   * @returns {Object} Purchase order details
   */
  async getPurchaseOrderById(id) {
    try {
      const purchaseOrder = await getSupplierPurchaseOrderById(id);

      if (!purchaseOrder) {
        return {
          success: false,
          message: 'Purchase order not found'
        };
      }

      return {
        success: true,
        data: purchaseOrder
      };
    } catch (error) {
      console.error('Error fetching purchase order:', error);
      throw new Error(`Failed to fetch purchase order: ${error.message}`);
    }
  }

  /**
   * Get purchase orders with filtering and pagination
   * @param {Object} filters - Filter options
   * @returns {Object} Paginated purchase orders
   */
  async getPurchaseOrders(filters = {}) {
    try {
      const result = await getSupplierPurchaseOrders(filters);

      return {
        success: true,
        data: result.data,
        pagination: result.pagination,
        filters: filters
      };
    } catch (error) {
      console.error('Error fetching purchase orders:', error);
      throw new Error(`Failed to fetch purchase orders: ${error.message}`);
    }
  }

  /**
   * Update purchase order status with workflow validation
   * @param {string} id - Purchase order ID
   * @param {string} newStatus - New status
   * @param {Object} additionalData - Additional update data
   * @param {string} userId - User making the update
   * @returns {Object} Update result
   */
  async updatePurchaseOrderStatus(id, newStatus, additionalData = {}, userId) {
    try {
      // Get current order
      const currentOrder = await getSupplierPurchaseOrderById(id);
      if (!currentOrder) {
        throw new Error('Purchase order not found');
      }

      // Validate status transition
      const isValidTransition = this.validateStatusTransition(currentOrder.status, newStatus);
      if (!isValidTransition) {
        throw new Error(`Invalid status transition from ${currentOrder.status} to ${newStatus}`);
      }

      // Check approval requirements
      if (newStatus === 'approved' && !this.canApprove(currentOrder, userId)) {
        throw new Error('Insufficient permissions to approve this purchase order');
      }

      // Update the order
      const updatedOrder = await updateSupplierPurchaseOrderStatus(id, newStatus, {
        ...additionalData,
        updatedBy: userId
      });

      // Emit status change event
      this.emit('purchaseOrderStatusChanged', {
        orderId: id,
        oldStatus: currentOrder.status,
        newStatus,
        updatedBy: userId,
        timestamp: new Date()
      });

      // Handle status-specific actions
      await this.handleStatusActions(updatedOrder, newStatus, userId);

      return {
        success: true,
        data: updatedOrder,
        message: `Purchase order status updated to ${newStatus}`
      };
    } catch (error) {
      console.error('Error updating purchase order status:', error);
      throw new Error(`Failed to update purchase order status: ${error.message}`);
    }
  }

  // ==================== RECEIVING AND INVENTORY ====================

  /**
   * Create receipt for incoming goods
   * @param {string} purchaseOrderId - Purchase order ID
   * @param {Object} receiptData - Receipt information
   * @param {Array} receivedItems - Items being received
   * @param {string} userId - User creating the receipt
   * @returns {Object} Created receipt
   */
  async createReceipt(purchaseOrderId, receiptData, receivedItems, userId) {
    try {
      // Validate purchase order exists and is in correct status
      const purchaseOrder = await getSupplierPurchaseOrderById(purchaseOrderId);
      if (!purchaseOrder) {
        throw new Error('Purchase order not found');
      }

      if (!['approved', 'sent', 'in_transit'].includes(purchaseOrder.status)) {
        throw new Error('Purchase order is not in a receivable status');
      }

      // Enrich receipt data
      const enrichedReceiptData = {
        ...receiptData,
        receivedBy: userId,
        receivedDate: receiptData.receivedDate || new Date()
      };

      // Create the receipt
      const receipt = await createPurchaseOrderReceipt(purchaseOrderId, enrichedReceiptData, receivedItems);

      // Emit receipt created event
      this.emit('receiptCreated', {
        receipt,
        purchaseOrderId,
        receivedBy: userId
      });

      return {
        success: true,
        data: receipt,
        message: 'Receipt created successfully'
      };
    } catch (error) {
      console.error('Error creating receipt:', error);
      throw new Error(`Failed to create receipt: ${error.message}`);
    }
  }

  /**
   * Process receipt and update inventory
   * @param {string} receiptId - Receipt ID
   * @param {string} userId - User processing the receipt
   * @returns {Object} Processing results
   */
  async processReceiptToInventory(receiptId, userId) {
    try {
      const result = await processReceiptToInventory(receiptId, userId);

      // Emit inventory updated event
      this.emit('inventoryUpdatedFromReceipt', {
        receiptId,
        inventoryUpdates: result.inventoryUpdates,
        processedBy: userId,
        timestamp: result.processedAt
      });

      // Check for reorder triggers
      await this.checkReorderTriggers(result.inventoryUpdates);

      return {
        success: true,
        data: result,
        message: 'Receipt processed and inventory updated successfully'
      };
    } catch (error) {
      console.error('Error processing receipt to inventory:', error);
      throw new Error(`Failed to process receipt: ${error.message}`);
    }
  }

  // ==================== ANALYTICS AND REPORTING ====================

  /**
   * Get purchase order analytics
   * @param {Object} filters - Analytics filters
   * @returns {Object} Analytics data
   */
  async getAnalytics(filters = {}) {
    try {
      const analytics = await getPurchaseOrderAnalytics(filters);

      return {
        success: true,
        data: analytics,
        generatedAt: new Date()
      };
    } catch (error) {
      console.error('Error generating analytics:', error);
      throw new Error(`Failed to generate analytics: ${error.message}`);
    }
  }

  /**
   * Get dashboard data for procurement overview
   * @returns {Object} Dashboard data
   */
  async getDashboardData() {
    try {
      const [pendingApprovals, readyForReceiving, analytics] = await Promise.all([
        getPendingApprovals(),
        getOrdersReadyForReceiving(),
        getPurchaseOrderAnalytics({
          dateFrom: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
        })
      ]);

      return {
        success: true,
        data: {
          pendingApprovals: {
            count: pendingApprovals.length,
            orders: pendingApprovals.slice(0, 5) // Top 5 for display
          },
          readyForReceiving: {
            count: readyForReceiving.length,
            orders: readyForReceiving.slice(0, 5)
          },
          monthlyAnalytics: analytics.summary,
          supplierPerformance: analytics.supplierPerformance.slice(0, 10)
        }
      };
    } catch (error) {
      console.error('Error generating dashboard data:', error);
      throw new Error(`Failed to generate dashboard data: ${error.message}`);
    }
  }

  // ==================== WORKFLOW AUTOMATION ====================

  /**
   * Generate automatic reorder suggestions based on inventory levels
   * @param {Object} criteria - Reorder criteria
   * @returns {Object} Reorder suggestions
   */
  async generateReorderSuggestions(criteria = {}) {
    try {
      // This would implement reorder logic based on:
      // - Inventory levels vs reorder points
      // - Historical consumption patterns
      // - Lead times
      // - Seasonal factors
      
      const suggestions = await this.calculateReorderSuggestions(criteria);

      return {
        success: true,
        data: suggestions,
        generatedAt: new Date()
      };
    } catch (error) {
      console.error('Error generating reorder suggestions:', error);
      throw new Error(`Failed to generate reorder suggestions: ${error.message}`);
    }
  }

  // ==================== HELPER METHODS ====================

  /**
   * Validate status transition rules
   * @param {string} currentStatus - Current status
   * @param {string} newStatus - New status
   * @returns {boolean} Is transition valid
   */
  validateStatusTransition(currentStatus, newStatus) {
    const validTransitions = {
      'draft': ['pending_approval', 'cancelled'],
      'pending_approval': ['approved', 'rejected', 'draft'],
      'approved': ['sent', 'cancelled'],
      'sent': ['acknowledged', 'cancelled'],
      'acknowledged': ['in_transit', 'cancelled'],
      'in_transit': ['delivered', 'cancelled'],
      'delivered': ['completed'],
      'completed': [],
      'cancelled': [],
      'rejected': ['draft']
    };

    return validTransitions[currentStatus]?.includes(newStatus) || false;
  }

  /**
   * Check if user can approve purchase order
   * @param {Object} purchaseOrder - Purchase order
   * @param {string} userId - User ID
   * @returns {boolean} Can approve
   */
  canApprove(purchaseOrder, userId) {
    // Implement approval logic based on:
    // - User permissions
    // - Order value thresholds
    // - Approval hierarchies
    return true; // Simplified for now
  }

  /**
   * Get approval threshold for automatic approval
   * @returns {number} Threshold amount
   */
  getApprovalThreshold() {
    return 10000; // $10,000 threshold
  }

  /**
   * Handle status-specific actions
   * @param {Object} order - Purchase order
   * @param {string} status - New status
   * @param {string} userId - User ID
   */
  async handleStatusActions(order, status, userId) {
    switch (status) {
      case 'approved':
        await this.notificationService.sendPurchaseOrderApproved(order);
        break;
      case 'sent':
        await this.notificationService.sendPurchaseOrderSent(order);
        break;
      case 'delivered':
        await this.notificationService.sendPurchaseOrderDelivered(order);
        break;
    }
  }

  /**
   * Check for items that need reordering
   * @param {Array} inventoryUpdates - Recent inventory updates
   */
  async checkReorderTriggers(inventoryUpdates) {
    for (const update of inventoryUpdates) {
      // Check if inventory level triggers reorder
      const inventory = await getInventoryByProductWarehouse(
        update.productId, 
        update.warehouseId
      );
      
      if (inventory && inventory.quantityOnHand <= inventory.reorderPoint) {
        this.emit('reorderTriggered', {
          productId: update.productId,
          warehouseId: update.warehouseId,
          currentLevel: inventory.quantityOnHand,
          reorderPoint: inventory.reorderPoint,
          suggestedQuantity: inventory.reorderQuantity
        });
      }
    }
  }

  /**
   * Calculate reorder suggestions (placeholder implementation)
   * @param {Object} criteria - Reorder criteria
   * @returns {Array} Reorder suggestions
   */
  async calculateReorderSuggestions(criteria) {
    // This would implement sophisticated reorder logic
    // For now, return empty array
    return [];
  }
}

export default new SupplierPurchaseOrderService();