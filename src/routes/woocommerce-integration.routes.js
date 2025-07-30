const express = require('express');
const router = express.Router();
const wooCommerceService = require('../services/woo-commerce.service');
const authMiddleware = require('../middleware/auth.middleware');
const { performance } = require('../middleware/performance.middleware');

/**
 * WooCommerce Integration Routes
 * Migrated from unified-extractor for bidirectional sync capabilities
 */

// Health check for WooCommerce API connection
router.get('/health', performance('woocommerce-health'), async (req, res) => {
  try {
    const health = await wooCommerceService.checkApiHealth();
    res.json({ 
      success: true, 
      status: health ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message,
      status: 'error'
    });
  }
});

// Sync customers from WooCommerce to NXT
router.post('/sync/customers', authMiddleware, performance('woocommerce-sync-customers'), async (req, res) => {
  try {
    const { force = false, limit = 100 } = req.body;
    const result = await wooCommerceService.syncCustomersToNXT(force, limit);
    
    res.json({
      success: true,
      message: `Successfully synced ${result.synced} customers`,
      details: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Sync products from WooCommerce to NXT inventory
router.post('/sync/products', authMiddleware, performance('woocommerce-sync-products'), async (req, res) => {
  try {
    const { force = false, limit = 100, updateInventory = true } = req.body;
    const result = await wooCommerceService.syncProductsToNXT(force, limit, updateInventory);
    
    res.json({
      success: true,
      message: `Successfully synced ${result.synced} products`,
      details: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Sync orders from WooCommerce to NXT
router.post('/sync/orders', authMiddleware, performance('woocommerce-sync-orders'), async (req, res) => {
  try {
    const { force = false, limit = 100, status = 'all' } = req.body;
    const result = await wooCommerceService.syncOrdersToNXT(force, limit, status);
    
    res.json({
      success: true,
      message: `Successfully synced ${result.synced} orders`,
      details: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Push inventory updates to WooCommerce
router.post('/push/inventory', authMiddleware, performance('woocommerce-push-inventory'), async (req, res) => {
  try {
    const { productIds = [], syncAll = false } = req.body;
    const result = await wooCommerceService.pushInventoryToWooCommerce(productIds, syncAll);
    
    res.json({
      success: true,
      message: `Successfully updated ${result.updated} products in WooCommerce`,
      details: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Push price updates to WooCommerce
router.post('/push/prices', authMiddleware, performance('woocommerce-push-prices'), async (req, res) => {
  try {
    const { productIds = [], syncAll = false } = req.body;
    const result = await wooCommerceService.pushPricesToWooCommerce(productIds, syncAll);
    
    res.json({
      success: true,
      message: `Successfully updated ${result.updated} product prices in WooCommerce`,
      details: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get sync status and statistics
router.get('/sync/status', authMiddleware, performance('woocommerce-sync-status'), async (req, res) => {
  try {
    const status = await wooCommerceService.getSyncStatus();
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get WooCommerce analytics (migrated from unified-extractor)
router.get('/analytics', authMiddleware, performance('woocommerce-analytics'), async (req, res) => {
  try {
    const { timeframe = '30d' } = req.query;
    const analytics = await wooCommerceService.getWooCommerceAnalytics(timeframe);
    
    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Configure WooCommerce API credentials
router.post('/configure', authMiddleware, performance('woocommerce-configure'), async (req, res) => {
  try {
    const { siteUrl, consumerKey, consumerSecret, version = 'wc/v3' } = req.body;
    
    if (!siteUrl || !consumerKey || !consumerSecret) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: siteUrl, consumerKey, consumerSecret'
      });
    }

    await wooCommerceService.configureApi(siteUrl, consumerKey, consumerSecret, version);
    
    res.json({
      success: true,
      message: 'WooCommerce API configuration updated successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Search WooCommerce customers (migrated functionality)
router.get('/search/customers', authMiddleware, performance('woocommerce-search-customers'), async (req, res) => {
  try {
    const { query, limit = 50 } = req.query;
    
    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Search query is required'
      });
    }

    const customers = await wooCommerceService.searchCustomers(query, limit);
    res.json({
      success: true,
      data: customers
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Search WooCommerce products (migrated functionality)
router.get('/search/products', authMiddleware, performance('woocommerce-search-products'), async (req, res) => {
  try {
    const { query, limit = 50 } = req.query;
    
    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Search query is required'
      });
    }

    const products = await wooCommerceService.searchProducts(query, limit);
    res.json({
      success: true,
      data: products
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;