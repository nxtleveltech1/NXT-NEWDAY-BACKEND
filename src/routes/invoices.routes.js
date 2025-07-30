import express from 'express';

const router = express.Router();

// Mock invoice data for immediate functionality
const mockInvoices = [
  {
    id: 'INV-2024-001',
    customerId: 'CUST-001',
    customerName: 'Acme Corporation',
    issueDate: '2024-01-15',
    dueDate: '2024-02-15',
    status: 'paid',
    subtotal: 1250.00,
    tax: 125.00,
    total: 1375.00,
    items: [
      { productId: 'P001', productName: 'Product A', quantity: 5, unitPrice: 200.00, total: 1000.00 },
      { productId: 'P002', productName: 'Product B', quantity: 1, unitPrice: 250.00, total: 250.00 }
    ]
  },
  {
    id: 'INV-2024-002',
    customerId: 'CUST-002',
    customerName: 'TechCorp Ltd',
    issueDate: '2024-01-20',
    dueDate: '2024-02-20',
    status: 'pending',
    subtotal: 2100.00,
    tax: 210.00,
    total: 2310.00,
    items: [
      { productId: 'P003', productName: 'Product C', quantity: 7, unitPrice: 300.00, total: 2100.00 }
    ]
  },
  {
    id: 'INV-2024-003',
    customerId: 'CUST-003',
    customerName: 'Global Industries',
    issueDate: '2024-01-25',
    dueDate: '2024-02-25',
    status: 'overdue',
    subtotal: 850.00,
    tax: 85.00,
    total: 935.00,
    items: [
      { productId: 'P004', productName: 'Product D', quantity: 2, unitPrice: 350.00, total: 700.00 },
      { productId: 'P005', productName: 'Product E', quantity: 3, unitPrice: 50.00, total: 150.00 }
    ]
  }
];

// Get all invoices with filters and pagination
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const status = req.query.status;
    const customerId = req.query.customerId;
    const dateFrom = req.query.dateFrom;
    const dateTo = req.query.dateTo;
    const search = req.query.search || '';
    
    let filteredInvoices = [...mockInvoices];
    
    // Apply filters
    if (status) {
      filteredInvoices = filteredInvoices.filter(invoice => invoice.status === status);
    }
    
    if (customerId) {
      filteredInvoices = filteredInvoices.filter(invoice => invoice.customerId === customerId);
    }
    
    if (search) {
      filteredInvoices = filteredInvoices.filter(invoice => 
        invoice.id.toLowerCase().includes(search.toLowerCase()) ||
        invoice.customerName.toLowerCase().includes(search.toLowerCase())
      );
    }
    
    if (dateFrom) {
      filteredInvoices = filteredInvoices.filter(invoice => 
        new Date(invoice.issueDate) >= new Date(dateFrom)
      );
    }
    
    if (dateTo) {
      filteredInvoices = filteredInvoices.filter(invoice => 
        new Date(invoice.issueDate) <= new Date(dateTo)
      );
    }
    
    // Pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedInvoices = filteredInvoices.slice(startIndex, endIndex);
    
    res.json({
      invoices: paginatedInvoices,
      pagination: {
        page,
        limit,
        total: filteredInvoices.length,
        totalPages: Math.ceil(filteredInvoices.length / limit)
      },
      summary: {
        totalInvoices: filteredInvoices.length,
        totalAmount: filteredInvoices.reduce((sum, inv) => sum + inv.total, 0),
        paidInvoices: filteredInvoices.filter(inv => inv.status === 'paid').length,
        pendingInvoices: filteredInvoices.filter(inv => inv.status === 'pending').length,
        overdueInvoices: filteredInvoices.filter(inv => inv.status === 'overdue').length
      }
    });
  } catch (err) {
    console.error('Error fetching invoices:', err);
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

// Get invoice by ID
router.get('/:id', async (req, res) => {
  try {
    const invoice = mockInvoices.find(inv => inv.id === req.params.id);
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    res.json(invoice);
  } catch (err) {
    console.error('Error fetching invoice:', err);
    res.status(500).json({ error: 'Failed to fetch invoice' });
  }
});

// Create new invoice
router.post('/', async (req, res) => {
  try {
    const newInvoice = {
      id: `INV-${new Date().getFullYear()}-${String(mockInvoices.length + 1).padStart(3, '0')}`,
      ...req.body,
      issueDate: req.body.issueDate || new Date().toISOString().split('T')[0],
      status: req.body.status || 'draft',
      createdBy: req.user.sub,
      createdAt: new Date().toISOString()
    };
    
    // Calculate totals
    if (newInvoice.items && Array.isArray(newInvoice.items)) {
      newInvoice.subtotal = newInvoice.items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
      newInvoice.tax = newInvoice.subtotal * (newInvoice.taxRate || 0.1);
      newInvoice.total = newInvoice.subtotal + newInvoice.tax;
    }
    
    mockInvoices.push(newInvoice);
    res.status(201).json(newInvoice);
  } catch (err) {
    console.error('Error creating invoice:', err);
    res.status(500).json({ error: err.message || 'Failed to create invoice' });
  }
});

// Update invoice
router.put('/:id', async (req, res) => {
  try {
    const invoiceIndex = mockInvoices.findIndex(inv => inv.id === req.params.id);
    if (invoiceIndex === -1) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    
    const updatedInvoice = {
      ...mockInvoices[invoiceIndex],
      ...req.body,
      updatedBy: req.user.sub,
      updatedAt: new Date().toISOString()
    };
    
    // Recalculate totals if items changed
    if (req.body.items && Array.isArray(req.body.items)) {
      updatedInvoice.subtotal = req.body.items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
      updatedInvoice.tax = updatedInvoice.subtotal * (updatedInvoice.taxRate || 0.1);
      updatedInvoice.total = updatedInvoice.subtotal + updatedInvoice.tax;
    }
    
    mockInvoices[invoiceIndex] = updatedInvoice;
    res.json(updatedInvoice);
  } catch (err) {
    console.error('Error updating invoice:', err);
    res.status(500).json({ error: err.message || 'Failed to update invoice' });
  }
});

// Delete invoice
router.delete('/:id', async (req, res) => {
  try {
    const invoiceIndex = mockInvoices.findIndex(inv => inv.id === req.params.id);
    if (invoiceIndex === -1) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    
    mockInvoices.splice(invoiceIndex, 1);
    res.json({ message: 'Invoice deleted successfully' });
  } catch (err) {
    console.error('Error deleting invoice:', err);
    res.status(500).json({ error: err.message || 'Failed to delete invoice' });
  }
});

// Send invoice to customer
router.put('/:id/send', async (req, res) => {
  try {
    const invoiceIndex = mockInvoices.findIndex(inv => inv.id === req.params.id);
    if (invoiceIndex === -1) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    
    mockInvoices[invoiceIndex].status = 'sent';
    mockInvoices[invoiceIndex].sentDate = new Date().toISOString();
    mockInvoices[invoiceIndex].sentBy = req.user.sub;
    
    res.json(mockInvoices[invoiceIndex]);
  } catch (err) {
    console.error('Error sending invoice:', err);
    res.status(500).json({ error: err.message || 'Failed to send invoice' });
  }
});

// Mark invoice as paid
router.put('/:id/pay', async (req, res) => {
  try {
    const invoiceIndex = mockInvoices.findIndex(inv => inv.id === req.params.id);
    if (invoiceIndex === -1) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    
    const { paymentMethod, paymentReference, paymentDate } = req.body;
    
    mockInvoices[invoiceIndex].status = 'paid';
    mockInvoices[invoiceIndex].paymentDate = paymentDate || new Date().toISOString();
    mockInvoices[invoiceIndex].paymentMethod = paymentMethod;
    mockInvoices[invoiceIndex].paymentReference = paymentReference;
    mockInvoices[invoiceIndex].paidBy = req.user.sub;
    
    res.json(mockInvoices[invoiceIndex]);
  } catch (err) {
    console.error('Error marking invoice as paid:', err);
    res.status(500).json({ error: err.message || 'Failed to mark invoice as paid' });
  }
});

// Generate invoice PDF
router.get('/:id/pdf', async (req, res) => {
  try {
    const invoice = mockInvoices.find(inv => inv.id === req.params.id);
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    
    // Mock PDF generation - in production, use a PDF library
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoice.id}.pdf"`);
    res.send(`Mock PDF content for invoice ${invoice.id}`);
  } catch (err) {
    console.error('Error generating invoice PDF:', err);
    res.status(500).json({ error: 'Failed to generate invoice PDF' });
  }
});

// Get invoice analytics
router.get('/analytics/summary', async (req, res) => {
  try {
    const dateFrom = req.query.dateFrom;
    const dateTo = req.query.dateTo;
    const customerId = req.query.customerId;
    
    let filteredInvoices = [...mockInvoices];
    
    if (dateFrom) {
      filteredInvoices = filteredInvoices.filter(invoice => 
        new Date(invoice.issueDate) >= new Date(dateFrom)
      );
    }
    
    if (dateTo) {
      filteredInvoices = filteredInvoices.filter(invoice => 
        new Date(invoice.issueDate) <= new Date(dateTo)
      );
    }
    
    if (customerId) {
      filteredInvoices = filteredInvoices.filter(invoice => invoice.customerId === customerId);
    }
    
    const analytics = {
      totalInvoices: filteredInvoices.length,
      totalRevenue: filteredInvoices.reduce((sum, inv) => sum + inv.total, 0),
      averageInvoiceValue: filteredInvoices.length > 0 ? 
        filteredInvoices.reduce((sum, inv) => sum + inv.total, 0) / filteredInvoices.length : 0,
      statusBreakdown: {
        draft: filteredInvoices.filter(inv => inv.status === 'draft').length,
        sent: filteredInvoices.filter(inv => inv.status === 'sent').length,
        pending: filteredInvoices.filter(inv => inv.status === 'pending').length,
        paid: filteredInvoices.filter(inv => inv.status === 'paid').length,
        overdue: filteredInvoices.filter(inv => inv.status === 'overdue').length,
        cancelled: filteredInvoices.filter(inv => inv.status === 'cancelled').length
      },
      paymentMetrics: {
        totalPaid: filteredInvoices
          .filter(inv => inv.status === 'paid')
          .reduce((sum, inv) => sum + inv.total, 0),
        totalOutstanding: filteredInvoices
          .filter(inv => ['sent', 'pending', 'overdue'].includes(inv.status))
          .reduce((sum, inv) => sum + inv.total, 0),
        overdueAmount: filteredInvoices
          .filter(inv => inv.status === 'overdue')
          .reduce((sum, inv) => sum + inv.total, 0)
      },
      monthlyTrends: generateMonthlyTrends(filteredInvoices)
    };
    
    res.json(analytics);
  } catch (err) {
    console.error('Error fetching invoice analytics:', err);
    res.status(500).json({ error: 'Failed to fetch invoice analytics' });
  }
});

// Helper function to generate monthly trends
function generateMonthlyTrends(invoices) {
  const trends = {};
  
  invoices.forEach(invoice => {
    const monthKey = invoice.issueDate.substring(0, 7); // YYYY-MM
    if (!trends[monthKey]) {
      trends[monthKey] = {
        month: monthKey,
        totalInvoices: 0,
        totalRevenue: 0,
        averageValue: 0
      };
    }
    trends[monthKey].totalInvoices++;
    trends[monthKey].totalRevenue += invoice.total;
  });
  
  // Calculate averages
  Object.keys(trends).forEach(month => {
    trends[month].averageValue = trends[month].totalRevenue / trends[month].totalInvoices;
  });
  
  return Object.values(trends).sort((a, b) => a.month.localeCompare(b.month));
}

export default router;