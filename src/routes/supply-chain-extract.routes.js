const express = require('express');
const router = express.Router();
const supplyChainExtractService = require('../services/supply-chain-extract.service');
const authMiddleware = require('../middleware/auth.middleware');
const { performance } = require('../middleware/performance.middleware');

/**
 * Supply Chain Extraction Routes
 * Enhanced functionality for suppliers and inventory extraction
 */

// Extract supplier data from various sources
router.post('/suppliers/extract', authMiddleware, performance('supply-chain-extract-suppliers'), async (req, res) => {
  try {
    const { source, config, filters = {} } = req.body;
    
    if (!source) {
      return res.status(400).json({
        success: false,
        error: 'Data source is required'
      });
    }

    const result = await supplyChainExtractService.extractSupplierData(source, config, filters);
    
    res.json({
      success: true,
      message: `Successfully extracted ${result.extracted} supplier records`,
      details: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Extract inventory data from multiple sources
router.post('/inventory/extract', authMiddleware, performance('supply-chain-extract-inventory'), async (req, res) => {
  try {
    const { sources = [], config, syncWithNXT = true } = req.body;
    
    if (!sources.length) {
      return res.status(400).json({
        success: false,
        error: 'At least one data source is required'
      });
    }

    const result = await supplyChainExtractService.extractInventoryData(sources, config, syncWithNXT);
    
    res.json({
      success: true,
      message: `Successfully extracted inventory from ${sources.length} sources`,
      details: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Extract purchase order data
router.post('/purchase-orders/extract', authMiddleware, performance('supply-chain-extract-po'), async (req, res) => {
  try {
    const { source, config, dateRange = {} } = req.body;
    
    const result = await supplyChainExtractService.extractPurchaseOrderData(source, config, dateRange);
    
    res.json({
      success: true,
      message: `Successfully extracted ${result.extracted} purchase orders`,
      details: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get available extraction sources
router.get('/sources', authMiddleware, performance('supply-chain-sources'), async (req, res) => {
  try {
    const sources = await supplyChainExtractService.getAvailableSources();
    
    res.json({
      success: true,
      sources: sources
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test connection to external source
router.post('/sources/test', authMiddleware, performance('supply-chain-test-source'), async (req, res) => {
  try {
    const { source, config } = req.body;
    
    if (!source || !config) {
      return res.status(400).json({
        success: false,
        error: 'Source and config are required'
      });
    }

    const result = await supplyChainExtractService.testSourceConnection(source, config);
    
    res.json({
      success: true,
      connected: result.connected,
      details: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get extraction job status
router.get('/jobs/:jobId/status', authMiddleware, performance('supply-chain-job-status'), async (req, res) => {
  try {
    const { jobId } = req.params;
    const status = await supplyChainExtractService.getJobStatus(jobId);
    
    res.json({
      success: true,
      status: status
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Cancel extraction job
router.post('/jobs/:jobId/cancel', authMiddleware, performance('supply-chain-cancel-job'), async (req, res) => {
  try {
    const { jobId } = req.params;
    const result = await supplyChainExtractService.cancelJob(jobId);
    
    res.json({
      success: true,
      message: 'Job cancelled successfully',
      details: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get extraction history
router.get('/history', authMiddleware, performance('supply-chain-history'), async (req, res) => {
  try {
    const { page = 1, limit = 20, source = null, type = null } = req.query;
    const history = await supplyChainExtractService.getExtractionHistory(
      parseInt(page), 
      parseInt(limit), 
      source,
      type
    );
    
    res.json({
      success: true,
      data: history
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Schedule recurring extraction
router.post('/schedule', authMiddleware, performance('supply-chain-schedule'), async (req, res) => {
  try {
    const { name, source, config, schedule, type } = req.body;
    
    if (!name || !source || !schedule || !type) {
      return res.status(400).json({
        success: false,
        error: 'Name, source, schedule, and type are required'
      });
    }

    const result = await supplyChainExtractService.scheduleExtraction(name, source, config, schedule, type);
    
    res.json({
      success: true,
      message: 'Extraction scheduled successfully',
      scheduleId: result.scheduleId
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get scheduled extractions
router.get('/schedules', authMiddleware, performance('supply-chain-schedules'), async (req, res) => {
  try {
    const schedules = await supplyChainExtractService.getScheduledExtractions();
    
    res.json({
      success: true,
      schedules: schedules
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Delete scheduled extraction
router.delete('/schedules/:scheduleId', authMiddleware, performance('supply-chain-delete-schedule'), async (req, res) => {
  try {
    const { scheduleId } = req.params;
    await supplyChainExtractService.deleteScheduledExtraction(scheduleId);
    
    res.json({
      success: true,
      message: 'Scheduled extraction deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get extraction analytics
router.get('/analytics', authMiddleware, performance('supply-chain-analytics'), async (req, res) => {
  try {
    const { timeframe = '30d', source = null } = req.query;
    const analytics = await supplyChainExtractService.getExtractionAnalytics(timeframe, source);
    
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

// Validate extraction configuration
router.post('/config/validate', authMiddleware, performance('supply-chain-validate-config'), async (req, res) => {
  try {
    const { source, config } = req.body;
    
    const validation = await supplyChainExtractService.validateExtractionConfig(source, config);
    
    res.json({
      success: true,
      validation: validation
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;