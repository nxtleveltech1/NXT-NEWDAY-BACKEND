import express from 'express';
const router = express.Router();

// Import inventory controller and middleware (dynamic import for compatibility)
let InventoryController, receiveStockValidation, shipStockValidation, transferStockValidation, adjustStockValidation;

// Initialize inventory controller (will need to pass io from main server)
let inventoryController = null;

// Initialize controller with socket.io instance
const initializeController = async (io) => {
  try {
    if (!InventoryController) {
      const imported = await import('../modules/inventory/controllers/InventoryController.js');
      InventoryController = imported.InventoryController;
      receiveStockValidation = imported.receiveStockValidation;
      shipStockValidation = imported.shipStockValidation;
      transferStockValidation = imported.transferStockValidation;
      adjustStockValidation = imported.adjustStockValidation;
    }
    inventoryController = new InventoryController(io);
  } catch (error) {
    console.warn('Inventory controller initialization error:', error.message);
  }
};

// Middleware to ensure controller is initialized
const ensureController = (req, res, next) => {
  if (!inventoryController) {
    return res.status(503).json({
      success: false,
      message: 'Inventory controller not initialized'
    });
  }
  next();
};

// Stock level routes
router.get('/warehouses/:warehouseId/stock', ensureController, (req, res) => {
  return inventoryController.getStockLevels(req, res);
});

router.get('/products/:productId/warehouses/:warehouseId/stock', ensureController, (req, res) => {
  return inventoryController.getProductStock(req, res);
});

router.get('/products/:productId/stock-summary', ensureController, (req, res) => {
  return inventoryController.getProductStockSummary(req, res);
});

// Stock operations
router.post('/products/:productId/warehouses/:warehouseId/initialize', ensureController, (req, res) => {
  return inventoryController.initializeStock(req, res);
});

router.post('/receive', receiveStockValidation, ensureController, (req, res) => {
  return inventoryController.receiveStock(req, res);
});

router.post('/ship', shipStockValidation, ensureController, (req, res) => {
  return inventoryController.shipStock(req, res);
});

router.post('/transfer', transferStockValidation, ensureController, (req, res) => {
  return inventoryController.transferStock(req, res);
});

router.post('/adjust', adjustStockValidation, ensureController, (req, res) => {
  return inventoryController.adjustStock(req, res);
});

// Stock reservation
router.post('/products/:productId/warehouses/:warehouseId/reserve', ensureController, (req, res) => {
  return inventoryController.reserveStock(req, res);
});

router.post('/products/:productId/warehouses/:warehouseId/release', ensureController, (req, res) => {
  return inventoryController.releaseReservedStock(req, res);
});

// Movement history
router.get('/products/:productId/warehouses/:warehouseId/movements', ensureController, (req, res) => {
  return inventoryController.getMovementHistory(req, res);
});

// Reports and analytics
router.get('/low-stock', ensureController, (req, res) => {
  return inventoryController.getLowStockItems(req, res);
});

router.get('/reorder', ensureController, (req, res) => {
  return inventoryController.getProductsNeedingReorder(req, res);
});

router.get('/valuation', ensureController, (req, res) => {
  return inventoryController.getStockValuation(req, res);
});

router.get('/dashboard', ensureController, (req, res) => {
  return inventoryController.getDashboardData(req, res);
});

router.get('/reports/:reportType', ensureController, (req, res) => {
  return inventoryController.generateReport(req, res);
});

// Alerts
router.get('/alerts', ensureController, (req, res) => {
  return inventoryController.getLowStockAlerts(req, res);
});

router.post('/alerts/:alertId/acknowledge', ensureController, (req, res) => {
  return inventoryController.acknowledgeLowStockAlert(req, res);
});

// Inventory system health check
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Advanced Inventory Management System integrated and running',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    controllerInitialized: inventoryController !== null,
    endpoints: {
      stock: '/api/inventory/*',
      operations: '/api/inventory/{receive,ship,transfer,adjust}',
      reports: '/api/inventory/{low-stock,reorder,valuation,dashboard}',
      alerts: '/api/inventory/alerts/*'
    }
  });
});

export { router as default, initializeController };