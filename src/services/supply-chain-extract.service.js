const db = require('../config/database');
const cacheService = require('./cache.service');
const supplierService = require('./supplier.service');

/**
 * Supply Chain Extraction Service
 * Enhanced functionality for suppliers and inventory extraction
 */

class SupplyChainExtractService {
  constructor() {
    this.supportedSources = [
      'csv_file',
      'excel_file',
      'json_api',
      'sql_database',
      'ftp_server',
      'email_attachment',
      'web_scraping',
      'manual_entry'
    ];

    this.extractionTypes = [
      'suppliers',
      'inventory',
      'purchase_orders',
      'price_lists',
      'product_catalog'
    ];
  }

  async getAvailableSources() {
    return this.supportedSources.map(source => ({
      id: source,
      name: this.getSourceDisplayName(source),
      description: this.getSourceDescription(source),
      configFields: this.getSourceConfigFields(source)
    }));
  }

  getSourceDisplayName(source) {
    const displayNames = {
      'csv_file': 'CSV File Upload',
      'excel_file': 'Excel File Upload',
      'json_api': 'JSON API Endpoint',
      'sql_database': 'SQL Database Connection',
      'ftp_server': 'FTP/SFTP Server',
      'email_attachment': 'Email Attachments',
      'web_scraping': 'Web Scraping',
      'manual_entry': 'Manual Data Entry'
    };
    return displayNames[source] || source;
  }

  getSourceDescription(source) {
    const descriptions = {
      'csv_file': 'Extract data from CSV files',
      'excel_file': 'Extract data from Excel spreadsheets',
      'json_api': 'Connect to REST/JSON APIs',
      'sql_database': 'Query external SQL databases',
      'ftp_server': 'Download files from FTP servers',
      'email_attachment': 'Process email attachments',
      'web_scraping': 'Extract data from websites',
      'manual_entry': 'Manual data entry interface'
    };
    return descriptions[source] || '';
  }

  getSourceConfigFields(source) {
    const configFields = {
      'json_api': [
        { name: 'url', type: 'string', required: true, description: 'API endpoint URL' },
        { name: 'apiKey', type: 'string', required: false, description: 'API key for authentication' },
        { name: 'headers', type: 'object', required: false, description: 'Additional HTTP headers' }
      ],
      'sql_database': [
        { name: 'host', type: 'string', required: true, description: 'Database host' },
        { name: 'port', type: 'number', required: true, description: 'Database port' },
        { name: 'database', type: 'string', required: true, description: 'Database name' },
        { name: 'username', type: 'string', required: true, description: 'Username' },
        { name: 'password', type: 'string', required: true, description: 'Password' },
        { name: 'query', type: 'text', required: true, description: 'SQL query to execute' }
      ],
      'ftp_server': [
        { name: 'host', type: 'string', required: true, description: 'FTP server host' },
        { name: 'port', type: 'number', required: false, description: 'FTP port (21 default)' },
        { name: 'username', type: 'string', required: true, description: 'Username' },
        { name: 'password', type: 'string', required: true, description: 'Password' },
        { name: 'path', type: 'string', required: true, description: 'File path on server' },
        { name: 'secure', type: 'boolean', required: false, description: 'Use SFTP' }
      ],
      'web_scraping': [
        { name: 'url', type: 'string', required: true, description: 'Target website URL' },
        { name: 'selectors', type: 'object', required: true, description: 'CSS selectors for data extraction' },
        { name: 'pagination', type: 'object', required: false, description: 'Pagination configuration' }
      ]
    };

    return configFields[source] || [];
  }

  // ==================== SUPPLIER EXTRACTION ====================

  async extractSupplierData(source, config, filters = {}) {
    try {
      const jobId = this.generateJobId();
      
      // Store job in database
      await this.createExtractionJob(jobId, 'suppliers', source, config, filters);

      let extractedData;
      switch (source) {
        case 'csv_file':
        case 'excel_file':
          extractedData = await this.extractFromFile(config.filePath, 'suppliers');
          break;
        case 'json_api':
          extractedData = await this.extractFromApi(config, 'suppliers');
          break;
        case 'sql_database':
          extractedData = await this.extractFromDatabase(config, 'suppliers');
          break;
        default:
          throw new Error(`Unsupported source: ${source}`);
      }

      // Apply filters
      const filteredData = this.applyFilters(extractedData, filters);

      // Transform and validate data
      const transformedData = await this.transformSupplierData(filteredData);

      // Import into NXT database
      const importResult = await this.importSupplierData(transformedData);

      // Update job status
      await this.updateJobStatus(jobId, 'completed', {
        extracted: extractedData.length,
        filtered: filteredData.length,
        imported: importResult.imported,
        errors: importResult.errors
      });

      return {
        jobId,
        extracted: extractedData.length,
        filtered: filteredData.length,
        imported: importResult.imported,
        errors: importResult.errors,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`Supplier extraction failed: ${error.message}`);
    }
  }

  async transformSupplierData(rawData) {
    return rawData.map(item => ({
      supplierCode: item.supplier_code || item.code || `EXT-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      companyName: item.company_name || item.name || item.supplier_name,
      email: item.email || item.contact_email,
      contactPerson: item.contact_person || item.contact_name,
      phone: item.phone || item.phone_number || item.contact_phone,
      address: item.address || this.combineAddress(item),
      paymentTerms: this.parsePaymentTerms(item.payment_terms),
      isActive: item.is_active !== undefined ? item.is_active : true,
      externalId: item.id || item.external_id,
      externalSource: 'extraction',
      contactDetails: {
        website: item.website,
        fax: item.fax,
        alternateEmail: item.alternate_email
      },
      metadata: {
        extractedAt: new Date().toISOString(),
        originalData: item
      }
    }));
  }

  async importSupplierData(transformedData) {
    const results = { imported: 0, updated: 0, skipped: 0, errors: [] };

    for (let i = 0; i < transformedData.length; i++) {
      try {
        const supplierData = transformedData[i];
        
        // Check if supplier already exists
        const existing = await db.query(
          'SELECT id FROM suppliers WHERE supplier_code = $1 OR email = $2',
          [supplierData.supplierCode, supplierData.email]
        );

        if (existing.rows.length > 0) {
          // Update existing supplier
          await db.query(`
            UPDATE suppliers SET 
              company_name = $1, contact_person = $2, phone = $3,
              address = $4, payment_terms = $5, contact_details = $6,
              external_id = $7, external_source = $8, updated_at = NOW()
            WHERE id = $9
          `, [
            supplierData.companyName, supplierData.contactPerson, supplierData.phone,
            supplierData.address, supplierData.paymentTerms, JSON.stringify(supplierData.contactDetails),
            supplierData.externalId, supplierData.externalSource, existing.rows[0].id
          ]);
          results.updated++;
        } else {
          // Insert new supplier
          await db.query(`
            INSERT INTO suppliers (
              supplier_code, company_name, email, contact_person, phone,
              address, payment_terms, is_active, external_id, external_source,
              contact_details, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
          `, [
            supplierData.supplierCode, supplierData.companyName, supplierData.email,
            supplierData.contactPerson, supplierData.phone, supplierData.address,
            supplierData.paymentTerms, supplierData.isActive, supplierData.externalId,
            supplierData.externalSource, JSON.stringify(supplierData.contactDetails)
          ]);
          results.imported++;
        }
      } catch (error) {
        results.errors.push({
          row: i + 1,
          error: error.message,
          data: transformedData[i]
        });
        results.skipped++;
      }
    }

    return results;
  }

  // ==================== INVENTORY EXTRACTION ====================

  async extractInventoryData(sources, config, syncWithNXT = true) {
    try {
      const jobId = this.generateJobId();
      await this.createExtractionJob(jobId, 'inventory', sources.join(','), config);

      let allExtractedData = [];

      // Extract from multiple sources
      for (const source of sources) {
        try {
          let sourceData;
          switch (source.type) {
            case 'csv_file':
            case 'excel_file':
              sourceData = await this.extractFromFile(source.config.filePath, 'inventory');
              break;
            case 'json_api':
              sourceData = await this.extractFromApi(source.config, 'inventory');
              break;
            default:
              console.warn(`Unsupported inventory source: ${source.type}`);
              continue;
          }

          // Tag data with source
          sourceData.forEach(item => {
            item._source = source.name || source.type;
          });

          allExtractedData.push(...sourceData);
        } catch (error) {
          console.error(`Failed to extract from source ${source.type}:`, error.message);
        }
      }

      // Transform inventory data
      const transformedData = await this.transformInventoryData(allExtractedData);

      let importResult = { imported: 0, updated: 0, errors: [] };
      if (syncWithNXT) {
        importResult = await this.importInventoryData(transformedData);
      }

      await this.updateJobStatus(jobId, 'completed', {
        extracted: allExtractedData.length,
        transformed: transformedData.length,
        imported: importResult.imported,
        updated: importResult.updated,
        errors: importResult.errors
      });

      return {
        jobId,
        extracted: allExtractedData.length,
        sources: sources.length,
        imported: importResult.imported,
        updated: importResult.updated,
        errors: importResult.errors,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`Inventory extraction failed: ${error.message}`);
    }
  }

  async transformInventoryData(rawData) {
    return rawData.map(item => ({
      sku: item.sku || item.product_code || item.item_code,
      productName: item.product_name || item.name || item.description,
      onHand: parseInt(item.on_hand || item.quantity || item.stock || 0),
      reserved: parseInt(item.reserved || item.allocated || 0),
      available: parseInt(item.available || (item.on_hand - item.reserved) || 0),
      reorderPoint: parseInt(item.reorder_point || item.min_stock || 0),
      reorderQuantity: parseInt(item.reorder_quantity || item.order_quantity || 0),
      lastCost: parseFloat(item.last_cost || item.cost || item.unit_cost || 0),
      averageCost: parseFloat(item.average_cost || item.avg_cost || 0),
      location: item.location || item.bin_location || item.warehouse,
      externalId: item.id || item.external_id,
      externalSource: item._source || 'extraction',
      lastUpdated: item.last_updated || item.updated_at || new Date().toISOString(),
      metadata: {
        extractedAt: new Date().toISOString(),
        originalData: item
      }
    }));
  }

  async importInventoryData(transformedData) {
    const results = { imported: 0, updated: 0, skipped: 0, errors: [] };

    // Get default warehouse
    const warehouse = await db.query('SELECT id FROM warehouses ORDER BY created_at LIMIT 1');
    if (warehouse.rows.length === 0) {
      throw new Error('No warehouse configured for inventory import');
    }
    const warehouseId = warehouse.rows[0].id;

    for (let i = 0; i < transformedData.length; i++) {
      try {
        const inventoryData = transformedData[i];
        
        // Find or create product
        let product = await db.query('SELECT id FROM products WHERE sku = $1', [inventoryData.sku]);
        
        if (product.rows.length === 0) {
          // Create product if it doesn't exist
          const productResult = await db.query(`
            INSERT INTO products (
              sku, name, external_id, external_source, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING id
          `, [
            inventoryData.sku, inventoryData.productName,
            inventoryData.externalId, inventoryData.externalSource
          ]);
          product = productResult;
        }

        const productId = product.rows[0].id;

        // Check if inventory record exists
        const existing = await db.query(
          'SELECT id, on_hand FROM inventory WHERE product_id = $1 AND warehouse_id = $2',
          [productId, warehouseId]
        );

        if (existing.rows.length > 0) {
          // Update existing inventory
          const oldQuantity = existing.rows[0].on_hand;
          const newQuantity = inventoryData.onHand;
          
          await db.query(`
            UPDATE inventory SET 
              on_hand = $1, reserved = $2, reorder_point = $3,
              reorder_quantity = $4, last_cost = $5, average_cost = $6,
              location = $7, updated_at = NOW()
            WHERE id = $8
          `, [
            newQuantity, inventoryData.reserved, inventoryData.reorderPoint,
            inventoryData.reorderQuantity, inventoryData.lastCost, inventoryData.averageCost,
            inventoryData.location, existing.rows[0].id
          ]);

          // Record movement if quantity changed
          if (oldQuantity !== newQuantity) {
            await db.query(`
              INSERT INTO inventory_movements (
                product_id, warehouse_id, movement_type, quantity,
                reference_type, reference_id, notes, performed_by, created_at
              ) VALUES ($1, $2, 'extraction_update', $3, 'extraction', $4, $5, 'system', NOW())
            `, [
              productId, warehouseId, newQuantity - oldQuantity,
              inventoryData.externalId || 'bulk_extraction',
              `Inventory updated via extraction from ${inventoryData.externalSource}`
            ]);
          }

          results.updated++;
        } else {
          // Insert new inventory record
          await db.query(`
            INSERT INTO inventory (
              product_id, warehouse_id, on_hand, reserved, reorder_point,
              reorder_quantity, last_cost, average_cost, location, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
          `, [
            productId, warehouseId, inventoryData.onHand, inventoryData.reserved,
            inventoryData.reorderPoint, inventoryData.reorderQuantity,
            inventoryData.lastCost, inventoryData.averageCost, inventoryData.location
          ]);

          // Record initial movement
          await db.query(`
            INSERT INTO inventory_movements (
              product_id, warehouse_id, movement_type, quantity,
              reference_type, reference_id, notes, performed_by, created_at
            ) VALUES ($1, $2, 'initial_stock', $3, 'extraction', $4, $5, 'system', NOW())
          `, [
            productId, warehouseId, inventoryData.onHand,
            inventoryData.externalId || 'bulk_extraction',
            `Initial inventory from extraction source: ${inventoryData.externalSource}`
          ]);

          results.imported++;
        }
      } catch (error) {
        results.errors.push({
          row: i + 1,
          error: error.message,
          sku: transformedData[i].sku
        });
        results.skipped++;
      }
    }

    return results;
  }

  // ==================== PURCHASE ORDER EXTRACTION ====================

  async extractPurchaseOrderData(source, config, dateRange = {}) {
    try {
      const jobId = this.generateJobId();
      await this.createExtractionJob(jobId, 'purchase_orders', source, config);

      let extractedData;
      switch (source) {
        case 'csv_file':
        case 'excel_file':
          extractedData = await this.extractFromFile(config.filePath, 'purchase_orders');
          break;
        case 'json_api':
          extractedData = await this.extractFromApi(config, 'purchase_orders');
          break;
        default:
          throw new Error(`Unsupported source: ${source}`);
      }

      // Apply date range filter
      if (dateRange.from || dateRange.to) {
        extractedData = this.filterByDateRange(extractedData, dateRange);
      }

      // Transform data
      const transformedData = await this.transformPurchaseOrderData(extractedData);

      // Import data
      const importResult = await this.importPurchaseOrderData(transformedData);

      await this.updateJobStatus(jobId, 'completed', {
        extracted: extractedData.length,
        imported: importResult.imported,
        errors: importResult.errors
      });

      return {
        jobId,
        extracted: extractedData.length,
        imported: importResult.imported,
        errors: importResult.errors,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`Purchase order extraction failed: ${error.message}`);
    }
  }

  // ==================== UTILITY METHODS ====================

  async testSourceConnection(source, config) {
    try {
      switch (source) {
        case 'json_api':
          const response = await fetch(config.url, {
            headers: config.headers || {}
          });
          return { connected: response.ok, status: response.status };
        
        case 'sql_database':
          // This would require appropriate database drivers
          // For now, return mock response
          return { connected: true, message: 'Database connection test not implemented' };
        
        default:
          return { connected: false, error: 'Connection test not available for this source' };
      }
    } catch (error) {
      return { connected: false, error: error.message };
    }
  }

  async getJobStatus(jobId) {
    try {
      const result = await db.query(
        'SELECT * FROM extraction_jobs WHERE id = $1',
        [jobId]
      );

      if (result.rows.length === 0) {
        throw new Error('Job not found');
      }

      return result.rows[0];
    } catch (error) {
      throw new Error(`Failed to get job status: ${error.message}`);
    }
  }

  async cancelJob(jobId) {
    try {
      const result = await db.query(
        'UPDATE extraction_jobs SET status = $1, completed_at = NOW() WHERE id = $2 RETURNING *',
        ['cancelled', jobId]
      );

      if (result.rows.length === 0) {
        throw new Error('Job not found');
      }

      return {
        jobId,
        status: 'cancelled',
        cancelledAt: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`Failed to cancel job: ${error.message}`);
    }
  }

  // Helper methods
  generateJobId() {
    return `ext_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async createExtractionJob(jobId, type, source, config, filters = {}) {
    await db.query(`
      INSERT INTO extraction_jobs (
        id, type, source, config, filters, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, 'running', NOW())
    `, [
      jobId, type, source, JSON.stringify(config), JSON.stringify(filters)
    ]);
  }

  async updateJobStatus(jobId, status, result = {}) {
    await db.query(`
      UPDATE extraction_jobs SET 
        status = $1, result = $2, completed_at = NOW()
      WHERE id = $3
    `, [status, JSON.stringify(result), jobId]);
  }

  applyFilters(data, filters) {
    // Apply various filters based on criteria
    return data.filter(item => {
      if (filters.active !== undefined && item.is_active !== filters.active) {
        return false;
      }
      if (filters.category && item.category !== filters.category) {
        return false;
      }
      // Add more filter logic as needed
      return true;
    });
  }

  combineAddress(item) {
    return [
      item.street_address || item.address_line_1,
      item.address_line_2,
      item.city,
      item.state || item.province,
      item.postal_code || item.zip_code,
      item.country
    ].filter(Boolean).join(', ');
  }

  parsePaymentTerms(terms) {
    if (!terms) return null;
    
    // Extract number of days from common formats
    const matches = terms.toString().match(/(\d+)\s*days?/i);
    return matches ? parseInt(matches[1]) : null;
  }

  filterByDateRange(data, { from, to }) {
    return data.filter(item => {
      const itemDate = new Date(item.date || item.created_at || item.order_date);
      if (from && itemDate < new Date(from)) return false;
      if (to && itemDate > new Date(to)) return false;
      return true;
    });
  }

  // Placeholder methods for file and API extraction
  async extractFromFile(filePath, type) {
    // This would implement file parsing logic
    throw new Error('File extraction not yet implemented');
  }

  async extractFromApi(config, type) {
    // This would implement API extraction logic
    throw new Error('API extraction not yet implemented');
  }

  async extractFromDatabase(config, type) {
    // This would implement database extraction logic
    throw new Error('Database extraction not yet implemented');
  }

  async transformPurchaseOrderData(rawData) {
    // Transform purchase order data
    return rawData;
  }

  async importPurchaseOrderData(transformedData) {
    // Import purchase order data
    return { imported: 0, errors: [] };
  }

  // Additional methods for history, scheduling, analytics, etc.
  async getExtractionHistory(page, limit, source, type) {
    const offset = (page - 1) * limit;
    let query = 'SELECT * FROM extraction_jobs WHERE 1=1';
    const params = [];

    if (source) {
      query += ` AND source = $${params.length + 1}`;
      params.push(source);
    }

    if (type) {
      query += ` AND type = $${params.length + 1}`;
      params.push(type);
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await db.query(query, params);
    return { history: result.rows };
  }

  async scheduleExtraction(name, source, config, schedule, type) {
    // Implement scheduling logic
    return { scheduleId: `sched_${Date.now()}` };
  }

  async getScheduledExtractions() {
    // Return scheduled extractions
    return [];
  }

  async deleteScheduledExtraction(scheduleId) {
    // Delete scheduled extraction
  }

  async getExtractionAnalytics(timeframe, source) {
    // Return analytics data
    return {};
  }

  async validateExtractionConfig(source, config) {
    // Validate configuration
    return { valid: true, errors: [] };
  }
}

module.exports = new SupplyChainExtractService();