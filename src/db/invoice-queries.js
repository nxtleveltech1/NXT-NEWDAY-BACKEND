import { eq, desc, asc, and, or, gte, lte, sql, count, sum } from 'drizzle-orm';
import { db } from '../config/database.js';
import { invoices, invoiceItems, payments, purchaseOrders, purchaseOrderItems, suppliers, customers, products } from './schema.js';

// ==================== INVOICE CRUD OPERATIONS ====================

/**
 * Get invoices with filtering and pagination
 */
export async function getInvoices(params = {}) {
  const {
    page = 1,
    limit = 10,
    search = '',
    status = null,
    invoiceType = null,
    supplierId = null,
    customerId = null,
    dateFrom = null,
    dateTo = null,
    sortBy = 'createdAt',
    sortOrder = 'desc'
  } = params;

  const offset = (page - 1) * limit;

  // Build where conditions
  const conditions = [];
  
  if (search) {
    conditions.push(
      or(
        sql`${invoices.invoiceNumber} ILIKE ${`%${search}%`}`,
        sql`${invoices.notes} ILIKE ${`%${search}%`}`
      )
    );
  }
  
  if (status) {
    conditions.push(eq(invoices.status, status));
  }
  
  if (invoiceType) {
    conditions.push(eq(invoices.invoiceType, invoiceType));
  }
  
  if (supplierId) {
    conditions.push(eq(invoices.supplierId, supplierId));
  }
  
  if (customerId) {
    conditions.push(eq(invoices.customerId, customerId));
  }
  
  if (dateFrom) {
    conditions.push(gte(invoices.invoiceDate, new Date(dateFrom)));
  }
  
  if (dateTo) {
    conditions.push(lte(invoices.invoiceDate, new Date(dateTo)));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Determine sort order
  const sortDirection = sortOrder === 'asc' ? asc : desc;
  const sortColumn = invoices[sortBy] || invoices.createdAt;

  // Get invoices with supplier and customer data
  const invoiceData = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      invoiceType: invoices.invoiceType,
      status: invoices.status,
      invoiceDate: invoices.invoiceDate,
      dueDate: invoices.dueDate,
      paidDate: invoices.paidDate,
      subtotal: invoices.subtotal,
      taxAmount: invoices.taxAmount,
      totalAmount: invoices.totalAmount,
      paidAmount: invoices.paidAmount,
      balanceAmount: invoices.balanceAmount,
      notes: invoices.notes,
      createdAt: invoices.createdAt,
      updatedAt: invoices.updatedAt,
      supplier: {
        id: suppliers.id,
        companyName: suppliers.companyName,
        supplierCode: suppliers.supplierCode,
        email: suppliers.email
      },
      customer: {
        id: customers.id,
        companyName: customers.companyName,
        customerCode: customers.customerCode,
        email: customers.email
      }
    })
    .from(invoices)
    .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
    .leftJoin(customers, eq(invoices.customerId, customers.id))
    .where(whereClause)
    .orderBy(sortDirection(sortColumn))
    .limit(limit)
    .offset(offset);

  // Get total count
  const [{ total }] = await db
    .select({ total: count() })
    .from(invoices)
    .where(whereClause);

  return {
    invoices: invoiceData,
    pagination: {
      page,
      limit,
      total: Number(total),
      pages: Math.ceil(Number(total) / limit)
    }
  };
}

/**
 * Get invoice by ID with full details
 */
export async function getInvoiceById(invoiceId) {
  const [invoice] = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      invoiceType: invoices.invoiceType,
      status: invoices.status,
      invoiceDate: invoices.invoiceDate,
      dueDate: invoices.dueDate,
      paidDate: invoices.paidDate,
      subtotal: invoices.subtotal,
      taxAmount: invoices.taxAmount,
      shippingCost: invoices.shippingCost,
      discountAmount: invoices.discountAmount,
      totalAmount: invoices.totalAmount,
      paidAmount: invoices.paidAmount,
      balanceAmount: invoices.balanceAmount,
      paymentTerms: invoices.paymentTerms,
      billingAddress: invoices.billingAddress,
      shippingAddress: invoices.shippingAddress,
      notes: invoices.notes,
      internalNotes: invoices.internalNotes,
      metadata: invoices.metadata,
      createdAt: invoices.createdAt,
      updatedAt: invoices.updatedAt,
      supplier: {
        id: suppliers.id,
        companyName: suppliers.companyName,
        supplierCode: suppliers.supplierCode,
        email: suppliers.email,
        phone: suppliers.phone,
        address: suppliers.address,
        paymentTerms: suppliers.paymentTerms
      },
      customer: {
        id: customers.id,
        companyName: customers.companyName,
        customerCode: customers.customerCode,
        email: customers.email,
        phone: customers.phone,
        address: customers.address
      },
      purchaseOrder: {
        id: purchaseOrders.id,
        orderNumber: purchaseOrders.orderNumber,
        status: purchaseOrders.status
      }
    })
    .from(invoices)
    .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
    .leftJoin(customers, eq(invoices.customerId, customers.id))
    .leftJoin(purchaseOrders, eq(invoices.purchaseOrderId, purchaseOrders.id))
    .where(eq(invoices.id, invoiceId));

  if (!invoice) {
    return null;
  }

  // Get invoice items
  const items = await db
    .select({
      id: invoiceItems.id,
      quantity: invoiceItems.quantity,
      unitPrice: invoiceItems.unitPrice,
      lineTotal: invoiceItems.lineTotal,
      taxAmount: invoiceItems.taxAmount,
      discountAmount: invoiceItems.discountAmount,
      productSku: invoiceItems.productSku,
      productName: invoiceItems.productName,
      productDescription: invoiceItems.productDescription,
      itemType: invoiceItems.itemType,
      product: {
        id: products.id,
        sku: products.sku,
        name: products.name,
        category: products.category
      }
    })
    .from(invoiceItems)
    .leftJoin(products, eq(invoiceItems.productId, products.id))
    .where(eq(invoiceItems.invoiceId, invoiceId));

  // Get payment history
  const paymentHistory = await db
    .select({
      id: payments.id,
      paymentNumber: payments.paymentNumber,
      paymentMethod: payments.paymentMethod,
      paymentAmount: payments.paymentAmount,
      paymentDate: payments.paymentDate,
      status: payments.status,
      bankReference: payments.bankReference,
      notes: payments.notes
    })
    .from(payments)
    .where(eq(payments.invoiceId, invoiceId))
    .orderBy(desc(payments.paymentDate));

  return {
    ...invoice,
    items,
    payments: paymentHistory
  };
}

/**
 * Create new invoice
 */
export async function createInvoice(invoiceData) {
  const { items, ...invoice } = invoiceData;

  return await db.transaction(async (tx) => {
    // Generate invoice number if not provided
    if (!invoice.invoiceNumber) {
      const year = new Date().getFullYear();
      const [{ count: invoiceCount }] = await tx
        .select({ count: count() })
        .from(invoices)
        .where(sql`EXTRACT(YEAR FROM invoice_date) = ${year}`);
      
      invoice.invoiceNumber = `INV-${year}-${String(Number(invoiceCount) + 1).padStart(6, '0')}`;
    }

    // Calculate totals
    let subtotal = 0;
    let totalTax = 0;
    let totalDiscount = 0;

    if (items && items.length > 0) {
      items.forEach(item => {
        const lineTotal = Number(item.quantity) * Number(item.unitPrice);
        const tax = Number(item.taxAmount || 0);
        const discount = Number(item.discountAmount || 0);
        
        subtotal += lineTotal;
        totalTax += tax;
        totalDiscount += discount;
      });
    }

    const totalAmount = subtotal + totalTax + Number(invoice.shippingCost || 0) - totalDiscount;
    const balanceAmount = totalAmount - Number(invoice.paidAmount || 0);

    // Create invoice
    const [newInvoice] = await tx
      .insert(invoices)
      .values({
        ...invoice,
        subtotal: subtotal.toString(),
        taxAmount: totalTax.toString(),
        totalAmount: totalAmount.toString(),
        balanceAmount: balanceAmount.toString(),
        updatedAt: new Date()
      })
      .returning();

    // Create invoice items
    if (items && items.length > 0) {
      const invoiceItemsData = items.map(item => ({
        invoiceId: newInvoice.id,
        productId: item.productId,
        purchaseOrderItemId: item.purchaseOrderItemId,
        quantity: item.quantity,
        unitPrice: item.unitPrice.toString(),
        lineTotal: (Number(item.quantity) * Number(item.unitPrice)).toString(),
        taxAmount: (item.taxAmount || 0).toString(),
        discountAmount: (item.discountAmount || 0).toString(),
        productSku: item.productSku,
        productName: item.productName,
        productDescription: item.productDescription,
        itemType: item.itemType || 'product'
      }));

      await tx.insert(invoiceItems).values(invoiceItemsData);
    }

    return newInvoice;
  });
}

/**
 * Update invoice
 */
export async function updateInvoice(invoiceId, updateData) {
  const { items, ...invoice } = updateData;

  return await db.transaction(async (tx) => {
    // Update invoice
    const [updatedInvoice] = await tx
      .update(invoices)
      .set({
        ...invoice,
        updatedAt: new Date()
      })
      .where(eq(invoices.id, invoiceId))
      .returning();

    if (!updatedInvoice) {
      throw new Error('Invoice not found');
    }

    // Update items if provided
    if (items) {
      // Delete existing items
      await tx.delete(invoiceItems).where(eq(invoiceItems.invoiceId, invoiceId));

      // Insert new items
      if (items.length > 0) {
        const invoiceItemsData = items.map(item => ({
          invoiceId: invoiceId,
          productId: item.productId,
          purchaseOrderItemId: item.purchaseOrderItemId,
          quantity: item.quantity,
          unitPrice: item.unitPrice.toString(),
          lineTotal: (Number(item.quantity) * Number(item.unitPrice)).toString(),
          taxAmount: (item.taxAmount || 0).toString(),
          discountAmount: (item.discountAmount || 0).toString(),
          productSku: item.productSku,
          productName: item.productName,
          productDescription: item.productDescription,
          itemType: item.itemType || 'product'
        }));

        await tx.insert(invoiceItems).values(invoiceItemsData);

        // Recalculate totals
        let subtotal = 0;
        let totalTax = 0;
        let totalDiscount = 0;

        items.forEach(item => {
          const lineTotal = Number(item.quantity) * Number(item.unitPrice);
          const tax = Number(item.taxAmount || 0);
          const discount = Number(item.discountAmount || 0);
          
          subtotal += lineTotal;
          totalTax += tax;
          totalDiscount += discount;
        });

        const totalAmount = subtotal + totalTax + Number(updatedInvoice.shippingCost || 0) - totalDiscount;
        const balanceAmount = totalAmount - Number(updatedInvoice.paidAmount || 0);

        // Update totals
        await tx
          .update(invoices)
          .set({
            subtotal: subtotal.toString(),
            taxAmount: totalTax.toString(),
            totalAmount: totalAmount.toString(),
            balanceAmount: balanceAmount.toString(),
            updatedAt: new Date()
          })
          .where(eq(invoices.id, invoiceId));
      }
    }

    return updatedInvoice;
  });
}

/**
 * Delete invoice (soft delete by changing status)
 */
export async function deleteInvoice(invoiceId) {
  const [deletedInvoice] = await db
    .update(invoices)
    .set({
      status: 'cancelled',
      updatedAt: new Date()
    })
    .where(eq(invoices.id, invoiceId))
    .returning();

  return deletedInvoice;
}

// ==================== PAYMENT OPERATIONS ====================

/**
 * Record payment for invoice
 */
export async function recordPayment(paymentData) {
  return await db.transaction(async (tx) => {
    // Generate payment number if not provided
    if (!paymentData.paymentNumber) {
      const year = new Date().getFullYear();
      const [{ count: paymentCount }] = await tx
        .select({ count: count() })
        .from(payments)
        .where(sql`EXTRACT(YEAR FROM payment_date) = ${year}`);
      
      paymentData.paymentNumber = `PAY-${year}-${String(Number(paymentCount) + 1).padStart(6, '0')}`;
    }

    // Create payment record
    const [payment] = await tx
      .insert(payments)
      .values({
        ...paymentData,
        paymentAmount: paymentData.paymentAmount.toString(),
        updatedAt: new Date()
      })
      .returning();

    // Update invoice paid amount and balance
    const [currentInvoice] = await tx
      .select({
        paidAmount: invoices.paidAmount,
        totalAmount: invoices.totalAmount
      })
      .from(invoices)
      .where(eq(invoices.id, paymentData.invoiceId));

    if (currentInvoice) {
      const newPaidAmount = Number(currentInvoice.paidAmount) + Number(paymentData.paymentAmount);
      const newBalanceAmount = Number(currentInvoice.totalAmount) - newPaidAmount;
      
      // Determine new status
      let newStatus = 'pending';
      if (newBalanceAmount <= 0) {
        newStatus = 'paid';
      } else if (newPaidAmount > 0) {
        newStatus = 'partial';
      }

      await tx
        .update(invoices)
        .set({
          paidAmount: newPaidAmount.toString(),
          balanceAmount: newBalanceAmount.toString(),
          status: newStatus,
          paidDate: newBalanceAmount <= 0 ? new Date() : null,
          updatedAt: new Date()
        })
        .where(eq(invoices.id, paymentData.invoiceId));
    }

    return payment;
  });
}

/**
 * Get payment history for invoice
 */
export async function getPaymentHistory(invoiceId) {
  return await db
    .select()
    .from(payments)
    .where(eq(payments.invoiceId, invoiceId))
    .orderBy(desc(payments.paymentDate));
}

// ==================== PURCHASE ORDER INTEGRATION ====================

/**
 * Get purchase orders for invoice creation
 */
export async function getPurchaseOrdersForInvoicing(supplierId) {
  return await db
    .select({
      id: purchaseOrders.id,
      orderNumber: purchaseOrders.orderNumber,
      status: purchaseOrders.status,
      orderDate: purchaseOrders.orderDate,
      totalAmount: purchaseOrders.totalAmount,
      supplier: {
        id: suppliers.id,
        companyName: suppliers.companyName,
        supplierCode: suppliers.supplierCode
      }
    })
    .from(purchaseOrders)
    .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
    .where(
      and(
        eq(purchaseOrders.supplierId, supplierId),
        or(
          eq(purchaseOrders.status, 'received'),
          eq(purchaseOrders.status, 'partial')
        )
      )
    )
    .orderBy(desc(purchaseOrders.orderDate));
}

/**
 * Get purchase order items for invoicing
 */
export async function getPurchaseOrderItems(purchaseOrderId) {
  return await db
    .select({
      id: purchaseOrderItems.id,
      quantity: purchaseOrderItems.quantity,
      quantityReceived: purchaseOrderItems.quantityReceived,
      quantityInvoiced: purchaseOrderItems.quantityInvoiced,
      unitPrice: purchaseOrderItems.unitPrice,
      lineTotal: purchaseOrderItems.lineTotal,
      productSku: purchaseOrderItems.productSku,
      productName: purchaseOrderItems.productName,
      productDescription: purchaseOrderItems.productDescription,
      product: {
        id: products.id,
        sku: products.sku,
        name: products.name,
        category: products.category
      }
    })
    .from(purchaseOrderItems)
    .leftJoin(products, eq(purchaseOrderItems.productId, products.id))
    .where(eq(purchaseOrderItems.purchaseOrderId, purchaseOrderId));
}

// ==================== ANALYTICS AND REPORTING ====================

/**
 * Get invoice analytics
 */
export async function getInvoiceAnalytics(params = {}) {
  const { dateFrom, dateTo, supplierId, customerId } = params;

  const conditions = [];
  
  if (dateFrom) {
    conditions.push(gte(invoices.invoiceDate, new Date(dateFrom)));
  }
  
  if (dateTo) {
    conditions.push(lte(invoices.invoiceDate, new Date(dateTo)));
  }
  
  if (supplierId) {
    conditions.push(eq(invoices.supplierId, supplierId));
  }
  
  if (customerId) {
    conditions.push(eq(invoices.customerId, customerId));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Get summary statistics
  const [summary] = await db
    .select({
      totalInvoices: count(),
      totalAmount: sum(invoices.totalAmount),
      totalPaid: sum(invoices.paidAmount),
      totalOutstanding: sum(invoices.balanceAmount)
    })
    .from(invoices)
    .where(whereClause);

  // Get status breakdown
  const statusBreakdown = await db
    .select({
      status: invoices.status,
      count: count(),
      totalAmount: sum(invoices.totalAmount)
    })
    .from(invoices)
    .where(whereClause)
    .groupBy(invoices.status);

  // Get overdue invoices
  const overdueInvoices = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      dueDate: invoices.dueDate,
      totalAmount: invoices.totalAmount,
      balanceAmount: invoices.balanceAmount,
      supplier: {
        companyName: suppliers.companyName
      }
    })
    .from(invoices)
    .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
    .where(
      and(
        lte(invoices.dueDate, new Date()),
        sql`${invoices.balanceAmount} > 0`,
        eq(invoices.status, 'pending'),
        whereClause || sql`true`
      )
    )
    .orderBy(asc(invoices.dueDate));

  return {
    summary: {
      totalInvoices: Number(summary.totalInvoices),
      totalAmount: Number(summary.totalAmount || 0),
      totalPaid: Number(summary.totalPaid || 0),
      totalOutstanding: Number(summary.totalOutstanding || 0)
    },
    statusBreakdown: statusBreakdown.map(item => ({
      status: item.status,
      count: Number(item.count),
      totalAmount: Number(item.totalAmount || 0)
    })),
    overdueInvoices: overdueInvoices.map(invoice => ({
      ...invoice,
      totalAmount: Number(invoice.totalAmount),
      balanceAmount: Number(invoice.balanceAmount),
      daysOverdue: Math.floor((new Date() - new Date(invoice.dueDate)) / (1000 * 60 * 60 * 24))
    }))
  };
}

/**
 * Check if invoice number exists
 */
export async function invoiceNumberExists(invoiceNumber, excludeId = null) {
  const conditions = [eq(invoices.invoiceNumber, invoiceNumber)];
  
  if (excludeId) {
    conditions.push(sql`${invoices.id} != ${excludeId}`);
  }

  const [result] = await db
    .select({ count: count() })
    .from(invoices)
    .where(and(...conditions));

  return Number(result.count) > 0;
}
