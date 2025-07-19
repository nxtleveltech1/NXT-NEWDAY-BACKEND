/**
 * Supply Chain Integration Service
 * 
 * This service orchestrates end-to-end supply chain workflows:
 * - Price upload → Product cost update → PO creation
 * - Purchase Order → Inventory receipt → Stock update  
 * - Customer Order → Stock allocation → Fulfillment
 * - Supply chain analytics and monitoring
 */

import { db } from '../db/index.js';
import { 
  suppliers, 
  priceLists, 
  priceListItems, 
  products, 
  inventory, 
  inventoryMovements,
  supplierPurchaseOrders,
  supplierPurchaseOrderItems,
  purchaseOrderReceipts,
  purchaseOrderReceiptItems,
  purchaseOrders,
  purchaseOrderItems,
  customers,
  timeSeriesEvents,
  timeSeriesMetrics
} from '../db/schema.js';
import { eq, and, desc, asc, gte, lte, isNull, sum, count, avg } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { EventEmitter } from 'events';

class SupplyChainIntegrationService extends EventEmitter {
  constructor() {
    super();
    this.isProcessing = false;
    this.processingQueue = [];
    this.retryConfig = {
      maxRetries: 3,
      retryDelay: 1000,
      backoffMultiplier: 2
    };
  }

  // ==================== PRICE UPLOAD INTEGRATION ====================

  /**
   * Process price list upload and trigger downstream workflows
   */
  async processPriceListUpload(priceListId, options = {}) {
    const startTime = Date.now();
    const eventId = `price-upload-${priceListId}-${Date.now()}`;
    
    try {
      await this.logEvent('price_upload_started', 'integration', {
        priceListId,
        eventId,
        options
      });

      // Get price list details
      const priceList = await db.select()
        .from(priceLists)
        .where(eq(priceLists.id, priceListId))
        .limit(1);

      if (!priceList.length) {
        throw new Error(`Price list ${priceListId} not found`);
      }

      const priceListData = priceList[0];
      
      // Get all items in the price list
      const priceItems = await db.select()
        .from(priceListItems)
        .where(eq(priceListItems.priceListId, priceListId));

      // Process each price item
      const results = {
        processed: 0,
        updated: 0,
        created: 0,
        errors: [],
        warnings: []
      };

      for (const item of priceItems) {
        try {
          const result = await this.processPriceItem(priceListData, item, options);
          results.processed++;
          if (result.action === 'updated') results.updated++;
          if (result.action === 'created') results.created++;
          if (result.warnings) results.warnings.push(...result.warnings);
        } catch (error) {
          results.errors.push({
            sku: item.sku,
            error: error.message
          });
        }
      }

      // Check if reorder suggestions should be generated
      if (options.triggerReorderSuggestions !== false) {
        await this.generateReorderSuggestions(priceListData.supplierId);
      }

      // Log completion
      const duration = Date.now() - startTime;
      await this.logEvent('price_upload_completed', 'integration', {
        priceListId,
        eventId,
        results,
        duration
      });

      await this.logMetric('price_upload_duration', duration, {
        supplier_id: priceListData.supplierId,
        item_count: priceItems.length
      });

      this.emit('priceUploadCompleted', {
        priceListId,
        supplierId: priceListData.supplierId,
        results,
        duration
      });

      return results;

    } catch (error) {
      const duration = Date.now() - startTime;
      await this.logEvent('price_upload_failed', 'integration', {
        priceListId,
        eventId,
        error: error.message,
        duration
      });

      this.emit('priceUploadFailed', {
        priceListId,
        error: error.message,
        duration
      });

      throw error;
    }
  }

  /**
   * Process individual price item and update product costs
   */
  async processPriceItem(priceList, priceItem, options = {}) {
    // Find matching product
    const existingProducts = await db.select()
      .from(products)
      .where(and(
        eq(products.sku, priceItem.sku),
        eq(products.supplierId, priceList.supplierId)
      ));

    let product;
    let action;

    if (existingProducts.length > 0) {
      // Update existing product
      product = existingProducts[0];
      
      const oldCostPrice = product.costPrice;
      const newCostPrice = priceItem.unitPrice;
      const priceChange = ((newCostPrice - oldCostPrice) / oldCostPrice * 100).toFixed(2);

      await db.update(products)
        .set({
          costPrice: newCostPrice,
          updatedAt: new Date()
        })
        .where(eq(products.id, product.id));

      action = 'updated';

      // Check for significant price changes
      const warnings = [];
      if (Math.abs(priceChange) > (options.priceChangeThreshold || 20)) {
        warnings.push({
          type: 'significant_price_change',
          message: `Price changed by ${priceChange}% for SKU ${priceItem.sku}`,
          oldPrice: oldCostPrice,
          newPrice: newCostPrice,
          changePercent: priceChange
        });

        // Emit price change alert
        this.emit('significantPriceChange', {
          productId: product.id,
          sku: priceItem.sku,
          oldPrice: oldCostPrice,
          newPrice: newCostPrice,
          changePercent: priceChange,
          supplierId: priceList.supplierId
        });
      }

      return { action, warnings };

    } else {
      // Create new product if auto-create is enabled
      if (options.autoCreateProducts !== false) {
        const [newProduct] = await db.insert(products)
          .values({
            sku: priceItem.sku,
            name: priceItem.description || priceItem.sku,
            description: priceItem.description,
            costPrice: priceItem.unitPrice,
            unitPrice: priceItem.unitPrice * (options.defaultMarkup || 1.3), // 30% markup default
            supplierId: priceList.supplierId,
            isActive: true,
            metadata: {
              source: 'price_list_upload',
              priceListId: priceList.id,
              createdFromPriceItem: priceItem.id
            }
          })
          .returning();

        action = 'created';
        return { action, product: newProduct };
      } else {
        throw new Error(`Product with SKU ${priceItem.sku} not found and auto-create is disabled`);
      }
    }
  }

  // ==================== PURCHASE ORDER INTEGRATION ====================

  /**
   * Generate purchase orders based on reorder points
   */
  async generateReorderSuggestions(supplierId, options = {}) {
    const startTime = Date.now();
    
    try {
      // Find products needing reorder from this supplier
      const lowStockProducts = await db.select({
        product: products,
        inventory: inventory,
        supplier: suppliers
      })
      .from(inventory)
      .innerJoin(products, eq(inventory.productId, products.id))
      .innerJoin(suppliers, eq(products.supplierId, suppliers.id))
      .where(and(
        eq(suppliers.id, supplierId),
        sql`${inventory.quantityAvailable} <= ${inventory.reorderPoint}`,
        eq(products.isActive, true)
      ));

      if (lowStockProducts.length === 0) {
        return { suggestions: [], message: 'No products need reordering' };
      }

      // Group by supplier and create PO suggestions
      const suggestions = lowStockProducts.map(item => ({
        productId: item.product.id,
        sku: item.product.sku,
        productName: item.product.name,
        currentStock: item.inventory.quantityAvailable,
        reorderPoint: item.inventory.reorderPoint,
        reorderQuantity: item.inventory.reorderQuantity || this.calculateOptimalOrderQuantity(item),
        estimatedCost: item.product.costPrice,
        supplierId: item.supplier.id,
        supplierName: item.supplier.companyName,
        leadTimeDays: item.supplier.leadTimeDays || 7
      }));

      // Calculate total order value
      const totalValue = suggestions.reduce((sum, item) => 
        sum + (item.reorderQuantity * item.estimatedCost), 0
      );

      await this.logEvent('reorder_suggestions_generated', 'integration', {
        supplierId,
        suggestionCount: suggestions.length,
        totalValue,
        suggestions: suggestions.slice(0, 10) // Log first 10 for audit
      });

      this.emit('reorderSuggestionsGenerated', {
        supplierId,
        suggestions,
        totalValue,
        timestamp: new Date()
      });

      return {
        suggestions,
        totalValue,
        supplierName: lowStockProducts[0]?.supplier.companyName,
        count: suggestions.length
      };

    } catch (error) {
      await this.logEvent('reorder_suggestions_failed', 'integration', {
        supplierId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Create supplier purchase order from reorder suggestions
   */
  async createSupplierPurchaseOrder(supplierId, items, options = {}) {
    const startTime = Date.now();
    const poNumber = await this.generatePONumber();
    
    try {
      // Get supplier details
      const supplier = await db.select()
        .from(suppliers)
        .where(eq(suppliers.id, supplierId))
        .limit(1);

      if (!supplier.length) {
        throw new Error(`Supplier ${supplierId} not found`);
      }

      const supplierData = supplier[0];

      // Calculate totals
      let subtotal = 0;
      const processedItems = [];

      for (const item of items) {
        const product = await db.select()
          .from(products)
          .where(eq(products.id, item.productId))
          .limit(1);

        if (!product.length) {
          throw new Error(`Product ${item.productId} not found`);
        }

        const lineTotal = item.quantity * item.unitPrice;
        subtotal += lineTotal;

        processedItems.push({
          ...item,
          product: product[0],
          lineTotal
        });
      }

      const taxAmount = subtotal * (options.taxRate || 0);
      const totalAmount = subtotal + taxAmount + (options.shippingAmount || 0);

      // Create purchase order
      const [purchaseOrder] = await db.insert(supplierPurchaseOrders)
        .values({
          poNumber,
          supplierId,
          orderDate: new Date(),
          expectedDeliveryDate: options.expectedDeliveryDate || 
            new Date(Date.now() + (supplierData.leadTimeDays || 7) * 24 * 60 * 60 * 1000),
          status: options.autoApprove ? 'approved' : 'draft',
          approvalStatus: options.autoApprove ? 'auto_approved' : 'pending',
          subtotal,
          taxAmount,
          shippingAmount: options.shippingAmount || 0,
          totalAmount,
          currency: options.currency || 'USD',
          paymentTerms: supplierData.paymentTerms?.terms || 'NET30',
          deliveryAddress: options.deliveryAddress || {},
          billingAddress: options.billingAddress || {},
          createdBy: options.createdBy,
          notes: options.notes,
          metadata: {
            source: 'reorder_automation',
            generatedAt: new Date(),
            options
          }
        })
        .returning();

      // Create purchase order items
      const poItems = [];
      for (const item of processedItems) {
        const [poItem] = await db.insert(supplierPurchaseOrderItems)
          .values({
            supplierPurchaseOrderId: purchaseOrder.id,
            productId: item.productId,
            sku: item.product.sku,
            productName: item.product.name,
            description: item.product.description,
            quantityOrdered: item.quantity,
            unitPrice: item.unitPrice,
            lineTotal: item.lineTotal,
            warehouseId: item.warehouseId,
            requestedDeliveryDate: purchaseOrder.expectedDeliveryDate,
            status: 'pending',
            metadata: {
              reorderSuggestion: true,
              currentStock: item.currentStock,
              reorderPoint: item.reorderPoint
            }
          })
          .returning();

        poItems.push(poItem);
      }

      await this.logEvent('supplier_po_created', 'integration', {
        poId: purchaseOrder.id,
        poNumber,
        supplierId,
        itemCount: poItems.length,
        totalAmount
      });

      this.emit('supplierPurchaseOrderCreated', {
        purchaseOrder,
        items: poItems,
        supplier: supplierData
      });

      return {
        purchaseOrder,
        items: poItems,
        summary: {
          poNumber,
          supplierId,
          totalAmount,
          itemCount: poItems.length,
          status: purchaseOrder.status
        }
      };

    } catch (error) {
      await this.logEvent('supplier_po_creation_failed', 'integration', {
        supplierId,
        error: error.message
      });
      throw error;
    }
  }

  // ==================== INVENTORY INTEGRATION ====================

  /**
   * Process purchase order receipt and update inventory
   */
  async processPurchaseOrderReceipt(receiptData, options = {}) {
    const startTime = Date.now();
    
    try {
      const receipt = await db.transaction(async (tx) => {
        // Create receipt record
        const [receiptRecord] = await tx.insert(purchaseOrderReceipts)
          .values({
            receiptNumber: await this.generateReceiptNumber(),
            supplierPurchaseOrderId: receiptData.purchaseOrderId,
            receivedDate: receiptData.receivedDate || new Date(),
            receivedBy: receiptData.receivedBy,
            warehouseId: receiptData.warehouseId,
            status: 'draft',
            carrierName: receiptData.carrierName,
            trackingNumber: receiptData.trackingNumber,
            packingSlipNumber: receiptData.packingSlipNumber,
            invoiceNumber: receiptData.invoiceNumber,
            qcRequired: receiptData.qcRequired || false,
            notes: receiptData.notes,
            metadata: receiptData.metadata || {}
          })
          .returning();

        // Process receipt items and update inventory
        const receiptItems = [];
        const inventoryUpdates = [];

        for (const item of receiptData.items) {
          // Create receipt item
          const [receiptItem] = await tx.insert(purchaseOrderReceiptItems)
            .values({
              receiptId: receiptRecord.id,
              supplierPurchaseOrderItemId: item.purchaseOrderItemId,
              productId: item.productId,
              sku: item.sku,
              quantityOrdered: item.quantityOrdered,
              quantityReceived: item.quantityReceived,
              quantityAccepted: item.quantityAccepted || item.quantityReceived,
              quantityRejected: item.quantityRejected || 0,
              warehouseId: receiptData.warehouseId,
              locationId: item.locationId,
              qcStatus: receiptData.qcRequired ? 'pending' : 'not_required',
              batchNumber: item.batchNumber,
              lotNumber: item.lotNumber,
              serialNumbers: item.serialNumbers || [],
              expiryDate: item.expiryDate,
              manufacturingDate: item.manufacturingDate,
              unitCost: item.unitCost,
              totalCost: item.quantityAccepted * item.unitCost,
              discrepancyType: item.discrepancyType,
              discrepancyNotes: item.discrepancyNotes,
              notes: item.notes,
              metadata: item.metadata || {}
            })
            .returning();

          receiptItems.push(receiptItem);

          // Update inventory
          const inventoryUpdate = await this.updateInventoryFromReceipt(
            tx, 
            item.productId, 
            receiptData.warehouseId,
            item.quantityAccepted,
            item.unitCost,
            {
              receiptId: receiptRecord.id,
              receiptItemId: receiptItem.id,
              batchNumber: item.batchNumber,
              lotNumber: item.lotNumber,
              expiryDate: item.expiryDate
            }
          );

          inventoryUpdates.push(inventoryUpdate);

          // Update supplier PO item received quantities
          await tx.update(supplierPurchaseOrderItems)
            .set({
              quantityReceived: sql`${supplierPurchaseOrderItems.quantityReceived} + ${item.quantityReceived}`,
              quantityAccepted: sql`${supplierPurchaseOrderItems.quantityAccepted} + ${item.quantityAccepted}`,
              quantityRejected: sql`${supplierPurchaseOrderItems.quantityRejected} + ${item.quantityRejected || 0}`,
              updatedAt: new Date()
            })
            .where(eq(supplierPurchaseOrderItems.id, item.purchaseOrderItemId));
        }

        // Update receipt status
        const hasDiscrepancies = receiptItems.some(item => 
          item.quantityReceived !== item.quantityOrdered || 
          item.quantityRejected > 0 ||
          item.discrepancyType
        );

        await tx.update(purchaseOrderReceipts)
          .set({
            status: hasDiscrepancies ? 'discrepancies' : 'completed',
            hasDiscrepancies,
            updatedAt: new Date()
          })
          .where(eq(purchaseOrderReceipts.id, receiptRecord.id));

        return {
          receipt: receiptRecord,
          items: receiptItems,
          inventoryUpdates,
          hasDiscrepancies
        };
      });

      await this.logEvent('po_receipt_processed', 'integration', {
        receiptId: receipt.receipt.id,
        poId: receiptData.purchaseOrderId,
        itemCount: receipt.items.length,
        hasDiscrepancies: receipt.hasDiscrepancies
      });

      this.emit('purchaseOrderReceiptProcessed', receipt);

      return receipt;

    } catch (error) {
      await this.logEvent('po_receipt_failed', 'integration', {
        poId: receiptData.purchaseOrderId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Update inventory from purchase order receipt
   */
  async updateInventoryFromReceipt(tx, productId, warehouseId, quantity, unitCost, metadata) {
    // Find or create inventory record
    const existingInventory = await tx.select()
      .from(inventory)
      .where(and(
        eq(inventory.productId, productId),
        eq(inventory.warehouseId, warehouseId)
      ))
      .limit(1);

    let inventoryRecord;

    if (existingInventory.length > 0) {
      // Update existing inventory
      const current = existingInventory[0];
      const newQuantity = current.quantityOnHand + quantity;
      const newAverageCost = ((current.quantityOnHand * current.averageCost) + (quantity * unitCost)) / newQuantity;

      await tx.update(inventory)
        .set({
          quantityOnHand: newQuantity,
          quantityAvailable: sql`${inventory.quantityAvailable} + ${quantity}`,
          averageCost: newAverageCost,
          lastPurchaseCost: unitCost,
          lastMovement: new Date(),
          stockStatus: newQuantity > 0 ? 'in_stock' : 'out_of_stock',
          updatedAt: new Date()
        })
        .where(eq(inventory.id, current.id));

      inventoryRecord = { ...current, quantityOnHand: newQuantity, averageCost: newAverageCost };
    } else {
      // Create new inventory record
      const [newInventory] = await tx.insert(inventory)
        .values({
          productId,
          warehouseId,
          quantityOnHand: quantity,
          quantityAvailable: quantity,
          quantityReserved: 0,
          quantityInTransit: 0,
          averageCost: unitCost,
          lastPurchaseCost: unitCost,
          lastMovement: new Date(),
          stockStatus: 'in_stock',
          reorderPoint: 10, // Default reorder point
          reorderQuantity: 50, // Default reorder quantity
          metadata: {
            createdFromReceipt: metadata.receiptId
          }
        })
        .returning();

      inventoryRecord = newInventory;
    }

    // Create inventory movement record
    const [movement] = await tx.insert(inventoryMovements)
      .values({
        inventoryId: inventoryRecord.id,
        productId,
        warehouseId,
        movementType: 'purchase',
        quantity,
        unitCost,
        totalCost: quantity * unitCost,
        referenceType: 'receipt',
        referenceId: metadata.receiptId,
        referenceNumber: metadata.receiptNumber,
        notes: `Purchase order receipt - Batch: ${metadata.batchNumber || 'N/A'}`,
        batchNumber: metadata.batchNumber,
        expiryDate: metadata.expiryDate,
        quantityAfter: inventoryRecord.quantityOnHand,
        runningTotal: inventoryRecord.quantityOnHand
      })
      .returning();

    return {
      inventory: inventoryRecord,
      movement
    };
  }

  // ==================== CUSTOMER ORDER INTEGRATION ====================

  /**
   * Process customer order and allocate inventory
   */
  async processCustomerOrder(orderData, options = {}) {
    const startTime = Date.now();
    
    try {
      const result = await db.transaction(async (tx) => {
        // Create customer order
        const [order] = await tx.insert(purchaseOrders)
          .values({
            orderNumber: await this.generateOrderNumber(),
            customerId: orderData.customerId,
            orderDate: orderData.orderDate || new Date(),
            status: 'pending',
            subtotal: 0, // Will be calculated
            taxAmount: 0,
            shippingAmount: orderData.shippingAmount || 0,
            discountAmount: orderData.discountAmount || 0,
            totalAmount: 0, // Will be calculated
            currency: orderData.currency || 'USD',
            paymentStatus: 'pending',
            paymentMethod: orderData.paymentMethod,
            paymentTerms: orderData.paymentTerms || 'NET30',
            shippingAddress: orderData.shippingAddress,
            billingAddress: orderData.billingAddress,
            notes: orderData.notes,
            referenceNumber: orderData.referenceNumber,
            createdBy: orderData.createdBy,
            metadata: orderData.metadata || {}
          })
          .returning();

        // Process order items and allocate inventory
        const orderItems = [];
        const allocations = [];
        let subtotal = 0;

        for (const item of orderData.items) {
          // Check inventory availability
          const availability = await this.checkInventoryAvailability(
            tx, 
            item.productId, 
            item.quantity,
            orderData.warehouseId
          );

          if (!availability.available && !options.allowBackorders) {
            throw new Error(`Insufficient inventory for product ${item.sku}. Available: ${availability.availableQuantity}, Requested: ${item.quantity}`);
          }

          // Create order item
          const lineTotal = item.quantity * item.unitPrice;
          subtotal += lineTotal;

          const [orderItem] = await tx.insert(purchaseOrderItems)
            .values({
              purchaseOrderId: order.id,
              productId: item.productId,
              sku: item.sku,
              productName: item.productName,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              discountPercent: item.discountPercent || 0,
              discountAmount: item.discountAmount || 0,
              lineTotal,
              taxRate: item.taxRate || 0,
              taxAmount: lineTotal * (item.taxRate || 0) / 100,
              warehouseId: orderData.warehouseId,
              notes: item.notes,
              metadata: item.metadata || {}
            })
            .returning();

          orderItems.push(orderItem);

          // Allocate inventory
          if (availability.available) {
            const allocation = await this.allocateInventory(
              tx,
              item.productId,
              orderData.warehouseId,
              item.quantity,
              {
                orderId: order.id,
                orderItemId: orderItem.id,
                orderNumber: order.orderNumber
              }
            );
            allocations.push(allocation);
          } else {
            // Handle backorder
            allocations.push({
              productId: item.productId,
              requestedQuantity: item.quantity,
              allocatedQuantity: availability.availableQuantity,
              backordered: item.quantity - availability.availableQuantity,
              status: 'backorder'
            });
          }
        }

        // Calculate totals
        const taxAmount = subtotal * (orderData.taxRate || 0) / 100;
        const totalAmount = subtotal + taxAmount + (orderData.shippingAmount || 0) - (orderData.discountAmount || 0);

        // Update order totals
        await tx.update(purchaseOrders)
          .set({
            subtotal,
            taxAmount,
            totalAmount,
            status: allocations.some(a => a.status === 'backorder') ? 'partial' : 'confirmed',
            updatedAt: new Date()
          })
          .where(eq(purchaseOrders.id, order.id));

        return {
          order: { ...order, subtotal, taxAmount, totalAmount },
          items: orderItems,
          allocations,
          summary: {
            itemCount: orderItems.length,
            totalAmount,
            fullyAllocated: !allocations.some(a => a.status === 'backorder'),
            backorderedItems: allocations.filter(a => a.status === 'backorder').length
          }
        };
      });

      await this.logEvent('customer_order_processed', 'integration', {
        orderId: result.order.id,
        customerId: orderData.customerId,
        itemCount: result.items.length,
        totalAmount: result.order.totalAmount,
        fullyAllocated: result.summary.fullyAllocated
      });

      this.emit('customerOrderProcessed', result);

      return result;

    } catch (error) {
      await this.logEvent('customer_order_failed', 'integration', {
        customerId: orderData.customerId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Check inventory availability for order allocation
   */
  async checkInventoryAvailability(tx, productId, requestedQuantity, warehouseId) {
    const inventoryData = await tx.select()
      .from(inventory)
      .where(and(
        eq(inventory.productId, productId),
        eq(inventory.warehouseId, warehouseId)
      ))
      .limit(1);

    if (!inventoryData.length) {
      return {
        available: false,
        availableQuantity: 0,
        requestedQuantity,
        shortage: requestedQuantity
      };
    }

    const stock = inventoryData[0];
    const availableQuantity = stock.quantityAvailable;
    const available = availableQuantity >= requestedQuantity;

    return {
      available,
      availableQuantity,
      requestedQuantity,
      shortage: available ? 0 : requestedQuantity - availableQuantity,
      inventory: stock
    };
  }

  /**
   * Allocate inventory for order
   */
  async allocateInventory(tx, productId, warehouseId, quantity, reference) {
    // Update inventory to reserve quantity
    const result = await tx.update(inventory)
      .set({
        quantityAvailable: sql`${inventory.quantityAvailable} - ${quantity}`,
        quantityReserved: sql`${inventory.quantityReserved} + ${quantity}`,
        lastMovement: new Date(),
        updatedAt: new Date()
      })
      .where(and(
        eq(inventory.productId, productId),
        eq(inventory.warehouseId, warehouseId),
        sql`${inventory.quantityAvailable} >= ${quantity}`
      ))
      .returning();

    if (!result.length) {
      throw new Error(`Failed to allocate inventory: insufficient available quantity`);
    }

    // Create inventory movement record
    const [movement] = await tx.insert(inventoryMovements)
      .values({
        inventoryId: result[0].id,
        productId,
        warehouseId,
        movementType: 'allocation',
        quantity: -quantity, // Negative for allocation
        referenceType: 'order',
        referenceId: reference.orderId,
        referenceNumber: reference.orderNumber,
        notes: `Inventory allocated for order ${reference.orderNumber}`,
        quantityAfter: result[0].quantityAvailable,
        runningTotal: result[0].quantityOnHand
      })
      .returning();

    return {
      productId,
      warehouseId,
      allocatedQuantity: quantity,
      status: 'allocated',
      inventory: result[0],
      movement
    };
  }

  // ==================== UTILITY METHODS ====================

  /**
   * Calculate optimal order quantity using EOQ or simple heuristics
   */
  calculateOptimalOrderQuantity(item) {
    // Simple heuristic: 2x current reorder point or minimum 30 days supply
    const product = item.product;
    const inventory = item.inventory;
    
    // If we have sales history, calculate average daily usage
    // For now, use simple heuristic
    const minOrder = inventory.reorderPoint * 2;
    const defaultOrder = inventory.reorderQuantity || 100;
    
    return Math.max(minOrder, defaultOrder);
  }

  /**
   * Generate unique PO number
   */
  async generatePONumber() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    // Get count of POs created today
    const todayStart = new Date(year, date.getMonth(), date.getDate());
    const todayEnd = new Date(year, date.getMonth(), date.getDate() + 1);
    
    const todayCount = await db.select({ count: count() })
      .from(supplierPurchaseOrders)
      .where(and(
        gte(supplierPurchaseOrders.createdAt, todayStart),
        lte(supplierPurchaseOrders.createdAt, todayEnd)
      ));

    const sequence = String((todayCount[0]?.count || 0) + 1).padStart(4, '0');
    return `SPO-${year}${month}${day}-${sequence}`;
  }

  /**
   * Generate unique receipt number
   */
  async generateReceiptNumber() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    const todayStart = new Date(year, date.getMonth(), date.getDate());
    const todayEnd = new Date(year, date.getMonth(), date.getDate() + 1);
    
    const todayCount = await db.select({ count: count() })
      .from(purchaseOrderReceipts)
      .where(and(
        gte(purchaseOrderReceipts.createdAt, todayStart),
        lte(purchaseOrderReceipts.createdAt, todayEnd)
      ));

    const sequence = String((todayCount[0]?.count || 0) + 1).padStart(4, '0');
    return `RCP-${year}${month}${day}-${sequence}`;
  }

  /**
   * Generate unique order number
   */
  async generateOrderNumber() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    const todayStart = new Date(year, date.getMonth(), date.getDate());
    const todayEnd = new Date(year, date.getMonth(), date.getDate() + 1);
    
    const todayCount = await db.select({ count: count() })
      .from(purchaseOrders)
      .where(and(
        gte(purchaseOrders.createdAt, todayStart),
        lte(purchaseOrders.createdAt, todayEnd)
      ));

    const sequence = String((todayCount[0]?.count || 0) + 1).padStart(4, '0');
    return `ORD-${year}${month}${day}-${sequence}`;
  }

  /**
   * Log integration event
   */
  async logEvent(eventType, category, data) {
    try {
      await db.insert(timeSeriesEvents)
        .values({
          timestamp: new Date(),
          eventType,
          eventCategory: category,
          entityType: data.entityType || 'integration',
          entityId: data.entityId,
          action: data.action || eventType,
          properties: data,
          metadata: {
            source: 'supply_chain_integration',
            version: '1.0'
          },
          duration: data.duration,
          resultStatus: data.error ? 'error' : 'success'
        });
    } catch (error) {
      console.error('Failed to log event:', error);
    }
  }

  /**
   * Log integration metric
   */
  async logMetric(metricName, value, dimensions = {}) {
    try {
      await db.insert(timeSeriesMetrics)
        .values({
          timestamp: new Date(),
          metricName,
          metricType: 'gauge',
          dimension1: dimensions.supplier_id,
          dimension2: dimensions.warehouse_id,
          dimension3: dimensions.product_id,
          value,
          tags: dimensions,
          metadata: {
            source: 'supply_chain_integration'
          }
        });
    } catch (error) {
      console.error('Failed to log metric:', error);
    }
  }

  // ==================== HEALTH CHECK ====================

  /**
   * Check supply chain integration health
   */
  async healthCheck() {
    const checks = {
      database: false,
      priceListProcessing: false,
      inventoryIntegrity: false,
      orderProcessing: false
    };

    try {
      // Check database connectivity
      await db.select({ count: count() }).from(suppliers).limit(1);
      checks.database = true;

      // Check recent price list processing
      const recentPriceLists = await db.select({ count: count() })
        .from(priceLists)
        .where(gte(priceLists.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)));
      checks.priceListProcessing = true;

      // Check inventory integrity
      const inventoryCheck = await db.select({
        totalRecords: count(),
        negativeStock: count(sql`CASE WHEN ${inventory.quantityOnHand} < 0 THEN 1 END`)
      })
      .from(inventory);
      checks.inventoryIntegrity = inventoryCheck[0].negativeStock === 0;

      // Check recent order processing
      const recentOrders = await db.select({ count: count() })
        .from(purchaseOrders)
        .where(gte(purchaseOrders.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)));
      checks.orderProcessing = true;

    } catch (error) {
      console.error('Health check failed:', error);
    }

    const isHealthy = Object.values(checks).every(check => check === true);

    return {
      healthy: isHealthy,
      checks,
      timestamp: new Date(),
      version: '1.0'
    };
  }
}

export const supplyChainIntegrationService = new SupplyChainIntegrationService();
export default supplyChainIntegrationService;