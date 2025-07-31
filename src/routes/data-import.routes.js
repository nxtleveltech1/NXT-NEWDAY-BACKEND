<<<<<<< HEAD
const express = require('express');
const router = express.Router();
const multer = require('multer');
const dataImportService = require('../services/data-import.service');
const authMiddleware = require('../middleware/auth.middleware');
const { performance } = require('../middleware/performance.middleware');
=======
import express from 'express';
const router = express.Router();
import multer from 'multer';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const dataImportService = require('../services/data-import.service.js');
import { protect as authMiddleware } from '../middleware/auth.middleware.js';
// import { performance } from '../middleware/performance.middleware.js';

// Simple performance middleware stub
const performance = (label) => (req, res, next) => next();
>>>>>>> 300aab3bb16173c33b69ac31996e9bb691d90580

// Configure multer for file uploads
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['text/csv', 'application/json', 'application/vnd.ms-excel', 
                          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
    if (allowedTypes.includes(file.mimetype) || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only CSV, JSON, XLS, and XLSX files are allowed.'));
    }
  }
});

/**
 * Data Import Routes
 * Migrated and enhanced from unified-extractor with PostgreSQL support
 */

// Get available tables for import
router.get('/tables', authMiddleware, performance('data-import-tables'), async (req, res) => {
  try {
    const tables = await dataImportService.getAvailableTables();
    res.json({
      success: true,
      tables: tables
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get table schema for mapping
router.get('/tables/:tableName/schema', authMiddleware, performance('data-import-schema'), async (req, res) => {
  try {
    const { tableName } = req.params;
    const schema = await dataImportService.getTableSchema(tableName);
    
    res.json({
      success: true,
      schema: schema
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Upload and preview file data
router.post('/preview', authMiddleware, upload.single('file'), performance('data-import-preview'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    const { tableName } = req.body;
    const preview = await dataImportService.previewFileData(req.file, tableName);
    
    res.json({
      success: true,
      preview: preview
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Import data from uploaded file
router.post('/import', authMiddleware, upload.single('file'), performance('data-import-execute'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    const { tableName, mapping, options = {} } = req.body;
    
    if (!tableName) {
      return res.status(400).json({
        success: false,
        error: 'Table name is required'
      });
    }

    // Parse mapping if it's a string
    let parsedMapping;
    try {
      parsedMapping = typeof mapping === 'string' ? JSON.parse(mapping) : mapping;
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: 'Invalid mapping format'
      });
    }

    console.log(`📥 Starting import to ${tableName} table...`);
    
    const result = await dataImportService.importFileData(
      req.file, 
      tableName, 
      parsedMapping,
      {
        skipFirstRow: options.skipFirstRow === 'true',
        batchSize: parseInt(options.batchSize) || 1000,
        onError: options.onError || 'skip'
      }
    );

    console.log(`✅ Successfully imported ${result.imported} records to ${tableName}`);

    res.json({
      success: true,
      message: `Successfully imported ${result.imported} records`,
      details: result
    });
  } catch (error) {
    console.error('❌ Import error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Import from raw JSON data (like unified-extractor)
router.post('/import/json', authMiddleware, performance('data-import-json'), async (req, res) => {
  try {
    const { tableName, data, mapping = null } = req.body;

    if (!tableName || !data || !Array.isArray(data) || data.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request. Please provide tableName and data array.'
      });
    }

    console.log(`📥 Importing ${data.length} records to ${tableName} table...`);

    const result = await dataImportService.importJsonData(tableName, data, mapping);

    console.log(`✅ Successfully imported ${result.imported} records to ${tableName}`);

    res.json({
      success: true,
      message: `Successfully imported ${result.imported} records to ${tableName}`,
      details: result
    });
  } catch (error) {
    console.error('❌ Import error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get import history
router.get('/history', authMiddleware, performance('data-import-history'), async (req, res) => {
  try {
    const { page = 1, limit = 20, tableName = null } = req.query;
    const history = await dataImportService.getImportHistory(
      parseInt(page), 
      parseInt(limit), 
      tableName
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

// Get import statistics
router.get('/stats', authMiddleware, performance('data-import-stats'), async (req, res) => {
  try {
    const { timeframe = '30d' } = req.query;
    const stats = await dataImportService.getImportStatistics(timeframe);
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Validate data before import
router.post('/validate', authMiddleware, upload.single('file'), performance('data-import-validate'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    const { tableName, mapping } = req.body;
    
    if (!tableName) {
      return res.status(400).json({
        success: false,
        error: 'Table name is required'
      });
    }

    let parsedMapping;
    try {
      parsedMapping = typeof mapping === 'string' ? JSON.parse(mapping) : mapping;
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: 'Invalid mapping format'
      });
    }

    const validation = await dataImportService.validateFileData(req.file, tableName, parsedMapping);
    
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

// Cancel ongoing import
router.post('/cancel/:importId', authMiddleware, performance('data-import-cancel'), async (req, res) => {
  try {
    const { importId } = req.params;
    const result = await dataImportService.cancelImport(importId);
    
    res.json({
      success: true,
      message: 'Import cancelled successfully',
      details: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

<<<<<<< HEAD
module.exports = router;
=======
export default router;
>>>>>>> 300aab3bb16173c33b69ac31996e9bb691d90580
