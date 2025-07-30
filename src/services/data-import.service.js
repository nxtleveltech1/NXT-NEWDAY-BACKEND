const fs = require('fs').promises;
const csv = require('csv-parse');
const xlsx = require('xlsx');
const db = require('../config/database');
const { parsePriceListFile, validatePriceListData } = require('../utils/file-parsers');

/**
 * Data Import Service
 * Migrated and enhanced from unified-extractor with PostgreSQL support
 */

class DataImportService {
  constructor() {
    this.allowedTables = [
      'customers', 'products', 'suppliers', 'orders', 
      'inventory', 'price_lists', 'purchase_orders'
    ];
  }

  async getAvailableTables() {
    return this.allowedTables.map(table => ({
      name: table,
      displayName: this.getTableDisplayName(table),
      description: this.getTableDescription(table)
    }));
  }

  getTableDisplayName(tableName) {
    const displayNames = {
      'customers': 'Customers',
      'products': 'Products',
      'suppliers': 'Suppliers',
      'orders': 'Orders',
      'inventory': 'Inventory',
      'price_lists': 'Price Lists',
      'purchase_orders': 'Purchase Orders'
    };
    return displayNames[tableName] || tableName;
  }

  getTableDescription(tableName) {
    const descriptions = {
      'customers': 'Customer contact information and details',
      'products': 'Product catalog and specifications',
      'suppliers': 'Supplier information and contacts',
      'orders': 'Sales orders and customer purchases',
      'inventory': 'Stock levels and warehouse data',
      'price_lists': 'Supplier pricing information',
      'purchase_orders': 'Purchase orders to suppliers'
    };
    return descriptions[tableName] || '';
  }

  async getTableSchema(tableName) {
    if (!this.allowedTables.includes(tableName)) {
      throw new Error(`Table '${tableName}' is not allowed for import`);
    }

    try {
      const result = await db.query(`
        SELECT 
          column_name,
          data_type,
          is_nullable,
          column_default,
          character_maximum_length
        FROM information_schema.columns 
        WHERE table_name = $1 
        AND table_schema = 'public'
        ORDER BY ordinal_position
      `, [tableName]);

      return result.rows.map(col => ({
        name: col.column_name,
        type: col.data_type,
        nullable: col.is_nullable === 'YES',
        default: col.column_default,
        maxLength: col.character_maximum_length,
        required: col.is_nullable === 'NO' && !col.column_default
      }));
    } catch (error) {
      throw new Error(`Failed to get schema for table '${tableName}': ${error.message}`);
    }
  }

  async previewFileData(file, tableName = null) {
    try {
      const data = await this.parseFile(file);
      const preview = {
        fileName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
        rowCount: data.length,
        columns: data.length > 0 ? Object.keys(data[0]) : [],
        sampleData: data.slice(0, 5), // First 5 rows
        suggestedMapping: null
      };

      if (tableName && this.allowedTables.includes(tableName)) {
        const schema = await this.getTableSchema(tableName);
        preview.suggestedMapping = this.generateColumnMapping(preview.columns, schema);
        preview.targetSchema = schema;
      }

      return preview;
    } catch (error) {
      throw new Error(`File preview failed: ${error.message}`);
    }
  }

  async parseFile(file) {
    const extension = file.originalname.split('.').pop().toLowerCase();
    
    switch (extension) {
      case 'csv':
        return await this.parseCsvFile(file);
      case 'json':
        return await this.parseJsonFile(file);
      case 'xlsx':
      case 'xls':
        return await this.parseExcelFile(file);
      default:
        throw new Error(`Unsupported file type: ${extension}`);
    }
  }

  async parseCsvFile(file) {
    return new Promise((resolve, reject) => {
      const results = [];
      const parser = csv.parse({
        columns: true,
        skip_empty_lines: true,
        trim: true
      });

      parser.on('readable', function() {
        let record;
        while (record = parser.read()) {
          results.push(record);
        }
      });

      parser.on('error', function(err) {
        reject(new Error(`CSV parsing error: ${err.message}`));
      });

      parser.on('end', function() {
        resolve(results);
      });

      parser.write(file.buffer);
      parser.end();
    });
  }

  async parseJsonFile(file) {
    try {
      const content = file.buffer.toString('utf8');
      const data = JSON.parse(content);
      
      if (!Array.isArray(data)) {
        throw new Error('JSON file must contain an array of objects');
      }

      return data;
    } catch (error) {
      throw new Error(`JSON parsing error: ${error.message}`);
    }
  }

  async parseExcelFile(file) {
    try {
      const workbook = xlsx.read(file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      
      const data = xlsx.utils.sheet_to_json(worksheet, { defval: null });
      return data;
    } catch (error) {
      throw new Error(`Excel parsing error: ${error.message}`);
    }
  }

  generateColumnMapping(fileColumns, schema) {
    const mapping = {};
    const schemaColumns = schema.map(col => col.name.toLowerCase());

    fileColumns.forEach(fileCol => {
      const normalized = fileCol.toLowerCase().replace(/[^a-z0-9]/g, '_');
      
      // Direct match
      let match = schemaColumns.find(schemaCol => 
        schemaCol === normalized || 
        schemaCol.includes(normalized) || 
        normalized.includes(schemaCol)
      );

      // Common field mappings
      if (!match) {
        const commonMappings = {
          'company': 'company_name',
          'firstname': 'first_name',
          'lastname': 'last_name',
          'phone': 'phone_number',
          'mobile': 'phone_number',
          'cost': 'unit_cost',
          'qty': 'quantity',
          'stock': 'on_hand',
          'description': 'product_description',
          'category': 'product_category'
        };

        match = commonMappings[normalized];
      }

      if (match) {
        mapping[fileCol] = match;
      }
    });

    return mapping;
  }

  async validateFileData(file, tableName, mapping) {
    if (!this.allowedTables.includes(tableName)) {
      throw new Error(`Table '${tableName}' is not allowed for import`);
    }

    try {
      const data = await this.parseFile(file);
      const schema = await this.getTableSchema(tableName);
      const validation = {
        valid: true,
        errors: [],
        warnings: [],
        rowCount: data.length,
        validRowCount: 0
      };

      // Validate each row
      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const rowErrors = [];

        // Check required fields
        schema.forEach(col => {
          if (col.required && mapping[col.name]) {
            const sourceColumn = Object.keys(mapping).find(k => mapping[k] === col.name);
            if (!sourceColumn || !row[sourceColumn] || row[sourceColumn].toString().trim() === '') {
              rowErrors.push(`Required field '${col.name}' is missing or empty`);
            }
          }
        });

        // Validate data types and constraints
        Object.keys(mapping).forEach(sourceCol => {
          const targetCol = mapping[sourceCol];
          const schemaCol = schema.find(s => s.name === targetCol);
          const value = row[sourceCol];

          if (value && schemaCol) {
            if (schemaCol.type.includes('integer') && isNaN(parseInt(value))) {
              rowErrors.push(`Field '${targetCol}' must be a number`);
            }
            if (schemaCol.type.includes('numeric') && isNaN(parseFloat(value))) {
              rowErrors.push(`Field '${targetCol}' must be a decimal number`);
            }
            if (schemaCol.maxLength && value.toString().length > schemaCol.maxLength) {
              rowErrors.push(`Field '${targetCol}' exceeds maximum length of ${schemaCol.maxLength}`);
            }
          }
        });

        if (rowErrors.length > 0) {
          validation.errors.push({
            row: i + 1,
            errors: rowErrors
          });
          validation.valid = false;
        } else {
          validation.validRowCount++;
        }
      }

      return validation;
    } catch (error) {
      throw new Error(`Validation failed: ${error.message}`);
    }
  }

  async importFileData(file, tableName, mapping, options = {}) {
    if (!this.allowedTables.includes(tableName)) {
      throw new Error(`Table '${tableName}' is not allowed for import`);
    }

    const {
      skipFirstRow = false,
      batchSize = 1000,
      onError = 'skip' // 'skip', 'abort', 'continue'
    } = options;

    try {
      let data = await this.parseFile(file);
      
      if (skipFirstRow && data.length > 0) {
        data = data.slice(1);
      }

      const schema = await this.getTableSchema(tableName);
      const importStats = {
        total: data.length,
        imported: 0,
        skipped: 0,
        errors: []
      };

      // Process in batches
      for (let i = 0; i < data.length; i += batchSize) {
        const batch = data.slice(i, i + batchSize);
        const batchResult = await this.processBatch(batch, tableName, mapping, schema, onError);
        
        importStats.imported += batchResult.imported;
        importStats.skipped += batchResult.skipped;
        importStats.errors.push(...batchResult.errors);
      }

      // Record import history
      await this.recordImportHistory({
        fileName: file.originalname,
        tableName,
        recordsTotal: importStats.total,
        recordsImported: importStats.imported,
        recordsSkipped: importStats.skipped,
        errorCount: importStats.errors.length,
        mapping: JSON.stringify(mapping),
        status: importStats.errors.length === 0 ? 'success' : 'partial'
      });

      return importStats;
    } catch (error) {
      throw new Error(`Import failed: ${error.message}`);
    }
  }

  async processBatch(batch, tableName, mapping, schema, onError) {
    const stats = { imported: 0, skipped: 0, errors: [] };
    
    for (let i = 0; i < batch.length; i++) {
      try {
        const row = batch[i];
        const mappedData = this.mapRowData(row, mapping, schema);
        
        await this.insertMappedData(tableName, mappedData);
        stats.imported++;
      } catch (error) {
        stats.errors.push({
          row: i + 1,
          error: error.message
        });

        if (onError === 'abort') {
          throw error;
        } else {
          stats.skipped++;
        }
      }
    }

    return stats;
  }

  mapRowData(row, mapping, schema) {
    const mappedData = {};
    
    Object.keys(mapping).forEach(sourceCol => {
      const targetCol = mapping[sourceCol];
      const schemaCol = schema.find(s => s.name === targetCol);
      let value = row[sourceCol];

      if (value !== null && value !== undefined && value !== '') {
        // Type conversion based on schema
        if (schemaCol) {
          if (schemaCol.type.includes('integer')) {
            value = parseInt(value);
          } else if (schemaCol.type.includes('numeric') || schemaCol.type.includes('decimal')) {
            value = parseFloat(value);
          } else if (schemaCol.type.includes('boolean')) {
            value = ['true', '1', 'yes', 'y'].includes(value.toString().toLowerCase());
          } else if (schemaCol.type.includes('timestamp') || schemaCol.type.includes('date')) {
            value = new Date(value);
          }
        }
      }

      mappedData[targetCol] = value;
    });

    return mappedData;
  }

  async insertMappedData(tableName, data) {
    const columns = Object.keys(data).filter(key => data[key] !== null && data[key] !== undefined);
    const values = columns.map(col => data[col]);
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');

    const query = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`;
    
    await db.query(query, values);
  }

  async importJsonData(tableName, data, mapping = null) {
    if (!this.allowedTables.includes(tableName)) {
      throw new Error(`Table '${tableName}' is not allowed for import`);
    }

    try {
      const schema = await this.getTableSchema(tableName);
      let finalMapping = mapping;

      // Auto-generate mapping if not provided
      if (!finalMapping && data.length > 0) {
        const fileColumns = Object.keys(data[0]);
        finalMapping = this.generateColumnMapping(fileColumns, schema);
      }

      const importStats = {
        total: data.length,
        imported: 0,
        skipped: 0,
        errors: []
      };

      for (let i = 0; i < data.length; i++) {
        try {
          const row = data[i];
          const mappedData = finalMapping ? 
            this.mapRowData(row, finalMapping, schema) : 
            row;
          
          await this.insertMappedData(tableName, mappedData);
          importStats.imported++;
        } catch (error) {
          importStats.errors.push({
            row: i + 1,
            error: error.message
          });
          importStats.skipped++;
        }
      }

      // Record import history
      await this.recordImportHistory({
        fileName: 'JSON Data Import',
        tableName,
        recordsTotal: importStats.total,
        recordsImported: importStats.imported,
        recordsSkipped: importStats.skipped,
        errorCount: importStats.errors.length,
        mapping: JSON.stringify(finalMapping),
        status: importStats.errors.length === 0 ? 'success' : 'partial'
      });

      return importStats;
    } catch (error) {
      throw new Error(`JSON import failed: ${error.message}`);
    }
  }

  async recordImportHistory(data) {
    try {
      await db.query(`
        INSERT INTO import_history (
          file_name, table_name, records_total, records_imported, 
          records_skipped, error_count, mapping, status, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      `, [
        data.fileName,
        data.tableName,
        data.recordsTotal,
        data.recordsImported,
        data.recordsSkipped,
        data.errorCount,
        data.mapping,
        data.status
      ]);
    } catch (error) {
      console.error('Failed to record import history:', error);
      // Don't throw here, as import succeeded
    }
  }

  async getImportHistory(page = 1, limit = 20, tableName = null) {
    const offset = (page - 1) * limit;
    let query = `
      SELECT 
        id, file_name, table_name, records_total, records_imported,
        records_skipped, error_count, status, created_at
      FROM import_history
    `;
    let countQuery = 'SELECT COUNT(*) FROM import_history';
    const params = [];

    if (tableName) {
      query += ' WHERE table_name = $1';
      countQuery += ' WHERE table_name = $1';
      params.push(tableName);
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const [historyResult, countResult] = await Promise.all([
      db.query(query, params),
      db.query(countQuery, tableName ? [tableName] : [])
    ]);

    const totalCount = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalCount / limit);

    return {
      imports: historyResult.rows,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    };
  }

  async getImportStatistics(timeframe = '30d') {
    const days = parseInt(timeframe.replace('d', ''));
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - days);

    try {
      const result = await db.query(`
        SELECT 
          table_name,
          COUNT(*) as import_count,
          SUM(records_imported) as total_records_imported,
          SUM(records_skipped) as total_records_skipped,
          SUM(error_count) as total_errors,
          COUNT(*) FILTER (WHERE status = 'success') as successful_imports
        FROM import_history
        WHERE created_at >= $1
        GROUP BY table_name
        ORDER BY total_records_imported DESC
      `, [dateFrom]);

      const overallStats = await db.query(`
        SELECT 
          COUNT(*) as total_imports,
          SUM(records_imported) as total_records,
          AVG(records_imported) as avg_records_per_import,
          COUNT(*) FILTER (WHERE status = 'success') as successful_imports
        FROM import_history
        WHERE created_at >= $1
      `, [dateFrom]);

      return {
        timeframe,
        dateFrom: dateFrom.toISOString(),
        byTable: result.rows,
        overall: overallStats.rows[0],
        generatedAt: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`Statistics generation failed: ${error.message}`);
    }
  }

  async cancelImport(importId) {
    // This would integrate with a job queue system in production
    // For now, just mark as cancelled in history if it exists
    try {
      const result = await db.query(
        'UPDATE import_history SET status = $1 WHERE id = $2 RETURNING *',
        ['cancelled', importId]
      );

      if (result.rows.length === 0) {
        throw new Error('Import not found');
      }

      return {
        importId,
        status: 'cancelled',
        cancelledAt: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`Cancel import failed: ${error.message}`);
    }
  }
}

module.exports = new DataImportService();