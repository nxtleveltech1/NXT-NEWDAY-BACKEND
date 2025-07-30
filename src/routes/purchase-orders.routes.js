import express from 'express';
import * as purchaseOrderQueries from '../db/purchase-order-queries.js';

const router = express.Router();

// Get all purchase orders with filters and pagination
router.get('/', async (req, res) => {
  try {
    const params = {
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 10,
      supplierId: req.query.supplierId || null,
      status: req.query.status || null,
      dateFrom: req.query.dateFrom || null,
      dateTo: req.query.dateTo || null,
      priority: req.query.priority || null,
      search: req.query.search || '',
      sortBy: req.query.sortBy || 'createdAt',
      sortOrder: req.query.sortOrder || 'desc'
    };
    
    const result = await purchaseOrderQueries.getPurchaseOrders(params);
    res.json(result);
  } catch (err) {
    console.error('Error fetching purchase orders:', err);
    res.status(500).json({ error: 'Failed to fetch purchase orders' });
  }
});

// Get purchase order by ID
router.get('/:id', async (req, res) => {
  try {
    const purchaseOrder = await purchaseOrderQueries.getPurchaseOrderById(req.params.id);
    if (!purchaseOrder) {
      return res.status(404).json({ error: 'Purchase order not found' });
    }
    res.json(purchaseOrder);
  } catch (err) {
    console.error('Error fetching purchase order:', err);
    res.status(500).json({ error: 'Failed to fetch purchase order' });
  }
});

// Create new purchase order
router.post('/', async (req, res) => {
  try {
    const purchaseOrderData = {
      ...req.body,
      createdBy: req.user.sub,
      status: req.body.status || 'draft'
    };
    
    const purchaseOrder = await purchaseOrderQueries.createPurchaseOrder(purchaseOrderData);
    res.status(201).json(purchaseOrder);
  } catch (err) {
    console.error('Error creating purchase order:', err);
    res.status(500).json({ error: err.message || 'Failed to create purchase order' });
  }
});

// Update purchase order
router.put('/:id', async (req, res) => {
  try {
    const updateData = {
      ...req.body,
      updatedBy: req.user.sub
    };
    
    const purchaseOrder = await purchaseOrderQueries.updatePurchaseOrder(req.params.id, updateData);
    if (!purchaseOrder) {
      return res.status(404).json({ error: 'Purchase order not found' });
    }
    res.json(purchaseOrder);
  } catch (err) {
    console.error('Error updating purchase order:', err);
    res.status(500).json({ error: err.message || 'Failed to update purchase order' });
  }
});

// Delete purchase order
router.delete('/:id', async (req, res) => {
  try {
    const result = await purchaseOrderQueries.deletePurchaseOrder(req.params.id);
    if (!result) {
      return res.status(404).json({ error: 'Purchase order not found' });
    }
    res.json({ message: 'Purchase order deleted successfully' });
  } catch (err) {
    console.error('Error deleting purchase order:', err);
    res.status(500).json({ error: err.message || 'Failed to delete purchase order' });
  }
});

// Submit purchase order for approval
router.put('/:id/submit', async (req, res) => {
  try {
    const purchaseOrder = await purchaseOrderQueries.updatePurchaseOrderStatus(
      req.params.id, 
      'pending_approval',
      req.user.sub
    );
    if (!purchaseOrder) {
      return res.status(404).json({ error: 'Purchase order not found' });
    }
    res.json(purchaseOrder);
  } catch (err) {
    console.error('Error submitting purchase order:', err);
    res.status(500).json({ error: err.message || 'Failed to submit purchase order' });
  }
});

// Handle purchase order approval/rejection
router.post('/:id/approval', async (req, res) => {
  try {
    const { action, notes = '' } = req.body;
    const userId = req.user?.sub || 'system';
    
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action. Must be "approve" or "reject"' });
    }
    
    const status = action === 'approve' ? 'approved' : 'rejected';
    const purchaseOrder = await purchaseOrderQueries.updatePurchaseOrderStatus(
      req.params.id, 
      status,
      userId,
      notes
    );
    
    if (!purchaseOrder) {
      return res.status(404).json({ error: 'Purchase order not found' });
    }
    res.json(purchaseOrder);
  } catch (err) {
    console.error('Error processing approval:', err);
    res.status(500).json({ error: err.message || 'Failed to process approval' });
  }
});

// Approve purchase order (legacy endpoint)
router.put('/:id/approve', async (req, res) => {
  try {
    const purchaseOrder = await purchaseOrderQueries.updatePurchaseOrderStatus(
      req.params.id, 
      'approved',
      req.user?.sub || 'system'
    );
    if (!purchaseOrder) {
      return res.status(404).json({ error: 'Purchase order not found' });
    }
    res.json(purchaseOrder);
  } catch (err) {
    console.error('Error approving purchase order:', err);
    res.status(500).json({ error: err.message || 'Failed to approve purchase order' });
  }
});

// Reject purchase order (legacy endpoint)
router.put('/:id/reject', async (req, res) => {
  try {
    const { reason } = req.body;
    const purchaseOrder = await purchaseOrderQueries.updatePurchaseOrderStatus(
      req.params.id, 
      'rejected',
      req.user?.sub || 'system',
      reason
    );
    if (!purchaseOrder) {
      return res.status(404).json({ error: 'Purchase order not found' });
    }
    res.json(purchaseOrder);
  } catch (err) {
    console.error('Error rejecting purchase order:', err);
    res.status(500).json({ error: err.message || 'Failed to reject purchase order' });
  }
});

// Send purchase order to supplier
router.put('/:id/send', async (req, res) => {
  try {
    const purchaseOrder = await purchaseOrderQueries.updatePurchaseOrderStatus(
      req.params.id, 
      'sent_to_supplier',
      req.user.sub
    );
    if (!purchaseOrder) {
      return res.status(404).json({ error: 'Purchase order not found' });
    }
    res.json(purchaseOrder);
  } catch (err) {
    console.error('Error sending purchase order:', err);
    res.status(500).json({ error: err.message || 'Failed to send purchase order' });
  }
});

// Receive goods for purchase order
router.put('/:id/receive', async (req, res) => {
  try {
    const { items, notes } = req.body;
    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'Items array is required' });
    }
    
    const result = await purchaseOrderQueries.receiveGoods(req.params.id, items, req.user.sub, notes);
    res.json(result);
  } catch (err) {
    console.error('Error receiving goods:', err);
    res.status(500).json({ error: err.message || 'Failed to receive goods' });
  }
});

// Get purchase order statistics
router.get('/statistics', async (req, res) => {
  try {
    const params = {
      supplierId: req.query.supplierId || null,
      dateFrom: req.query.dateFrom || null,
      dateTo: req.query.dateTo || null,
      status: req.query.status || null
    };
    
    const statistics = await purchaseOrderQueries.getPurchaseOrderStatistics(params);
    res.json(statistics);
  } catch (err) {
    console.error('Error fetching purchase order statistics:', err);
    res.status(500).json({ error: 'Failed to fetch purchase order statistics' });
  }
});

// Get purchase order analytics
router.get('/analytics/summary', async (req, res) => {
  try {
    const params = {
      supplierId: req.query.supplierId || null,
      dateFrom: req.query.dateFrom || null,
      dateTo: req.query.dateTo || null,
      status: req.query.status || null
    };
    
    const analytics = await purchaseOrderQueries.getPurchaseOrderAnalytics(params);
    res.json(analytics);
  } catch (err) {
    console.error('Error fetching purchase order analytics:', err);
    res.status(500).json({ error: 'Failed to fetch purchase order analytics' });
  }
});

// Get purchase order items
router.get('/:id/items', async (req, res) => {
  try {
    const items = await purchaseOrderQueries.getPurchaseOrderItems(req.params.id);
    res.json(items);
  } catch (err) {
    console.error('Error fetching purchase order items:', err);
    res.status(500).json({ error: 'Failed to fetch purchase order items' });
  }
});

// Add items to purchase order
router.post('/:id/items', async (req, res) => {
  try {
    const { items } = req.body;
    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'Items array is required' });
    }
    
    const result = await purchaseOrderQueries.addPurchaseOrderItems(req.params.id, items);
    res.status(201).json(result);
  } catch (err) {
    console.error('Error adding purchase order items:', err);
    res.status(500).json({ error: err.message || 'Failed to add purchase order items' });
  }
});

// Update purchase order item
router.put('/:id/items/:itemId', async (req, res) => {
  try {
    const result = await purchaseOrderQueries.updatePurchaseOrderItem(
      req.params.id, 
      req.params.itemId, 
      req.body
    );
    if (!result) {
      return res.status(404).json({ error: 'Purchase order item not found' });
    }
    res.json(result);
  } catch (err) {
    console.error('Error updating purchase order item:', err);
    res.status(500).json({ error: err.message || 'Failed to update purchase order item' });
  }
});

// Remove purchase order item
router.delete('/:id/items/:itemId', async (req, res) => {
  try {
    const result = await purchaseOrderQueries.removePurchaseOrderItem(req.params.id, req.params.itemId);
    if (!result) {
      return res.status(404).json({ error: 'Purchase order item not found' });
    }
    res.json({ message: 'Purchase order item removed successfully' });
  } catch (err) {
    console.error('Error removing purchase order item:', err);
    res.status(500).json({ error: err.message || 'Failed to remove purchase order item' });
  }
});

export default router;