import { parse } from 'csv-parse';
import { Readable } from 'stream';

// Standard column mappings for price list CSV files
const COLUMN_MAPPINGS = {
  // Common variations of SKU column names
  sku: ['sku', 'product_code', 'item_code', 'part_number', 'product_id', 'item_id'],
  // Common variations of description column names
  description: ['description', 'product_description', 'item_description', 'name', 'product_name'],
  // Common variations of price column names
  unitPrice: ['unit_price', 'price', 'cost', 'unit_cost', 'list_price'],
  // Common variations of currency column names
  currency: ['currency', 'currency_code', 'curr'],
  // Common variations of minimum order quantity column names
  minimumOrderQuantity: ['moq', 'min_order_qty', 'minimum_order_quantity', 'min_qty'],
  // Common variations of unit of measure column names
  unitOfMeasure: ['uom', 'unit_of_measure', 'unit', 'units']
};

// Find column index by trying different variations
function findColumnIndex(headers, columnVariations) {
  const normalizedHeaders = headers.map(h => h.toLowerCase().trim().replace(/\s+/g, '_'));
  
  for (const variation of columnVariations) {
    const index = normalizedHeaders.indexOf(variation.toLowerCase());
    if (index !== -1) return index;
  }
  
  return -1;
}

// Parse CSV buffer and extract price list data
export async function parseCSV(fileBuffer, options = {}) {
  const {
    delimiter = ',',
    skipEmptyLines = true,
    trimValues = true,
    encoding = 'utf-8'
  } = options;

  return new Promise((resolve, reject) => {
    const results = [];
    const errors = [];
    let headers = null;
    let columnIndexes = {};
    let rowNumber = 0;

    // Convert buffer to readable stream
    const stream = Readable.from(fileBuffer.toString(encoding));

    // Configure CSV parser
    const parser = parse({
      delimiter,
      skip_empty_lines: skipEmptyLines,
      trim: trimValues,
      relax_quotes: true,
      relax_column_count: true,
      on_record: (record, info) => {
        rowNumber++;

        // First row should be headers
        if (!headers) {
          headers = record;
          
          // Map column names to indexes
          for (const [field, variations] of Object.entries(COLUMN_MAPPINGS)) {
            const index = findColumnIndex(headers, variations);
            if (index !== -1) {
              columnIndexes[field] = index;
            }
          }

          // Validate required columns
          if (columnIndexes.sku === undefined) {
            errors.push({
              row: 1,
              error: 'Required column "SKU" not found. Expected one of: ' + COLUMN_MAPPINGS.sku.join(', ')
            });
          }
          if (columnIndexes.unitPrice === undefined) {
            errors.push({
              row: 1,
              error: 'Required column "Unit Price" not found. Expected one of: ' + COLUMN_MAPPINGS.unitPrice.join(', ')
            });
          }

          return;
        }

        // Skip empty rows
        if (record.every(cell => !cell || cell.trim() === '')) {
          return;
        }

        try {
          // Extract data based on column mappings
          const item = {
            sku: record[columnIndexes.sku] || '',
            description: columnIndexes.description !== undefined ? record[columnIndexes.description] : '',
            unitPrice: parseFloat(record[columnIndexes.unitPrice]) || 0,
            currency: columnIndexes.currency !== undefined ? record[columnIndexes.currency] : 'USD',
            minimumOrderQuantity: columnIndexes.minimumOrderQuantity !== undefined 
              ? parseInt(record[columnIndexes.minimumOrderQuantity]) || 1 
              : 1,
            unitOfMeasure: columnIndexes.unitOfMeasure !== undefined 
              ? record[columnIndexes.unitOfMeasure] 
              : 'EA'
          };

          // Validate required fields
          if (!item.sku) {
            errors.push({
              row: rowNumber,
              error: 'SKU is required',
              data: record
            });
            return;
          }

          if (isNaN(item.unitPrice) || item.unitPrice <= 0) {
            errors.push({
              row: rowNumber,
              error: 'Invalid unit price',
              data: record
            });
            return;
          }

          // Look for tier pricing columns (e.g., qty_10, price_10, qty_50, price_50)
          const tierPricing = [];
          for (let i = 0; i < headers.length; i++) {
            const header = headers[i].toLowerCase();
            const qtyMatch = header.match(/qty[_\s]*(\d+)/);
            if (qtyMatch) {
              const tier = qtyMatch[1];
              const priceHeader = `price_${tier}`;
              const priceIndex = headers.findIndex(h => 
                h.toLowerCase().replace(/\s+/g, '_') === priceHeader
              );
              
              if (priceIndex !== -1 && record[i] && record[priceIndex]) {
                tierPricing.push({
                  minQuantity: parseInt(record[i]),
                  price: parseFloat(record[priceIndex])
                });
              }
            }
          }

          if (tierPricing.length > 0) {
            item.tierPricing = tierPricing.sort((a, b) => a.minQuantity - b.minQuantity);
          }

          results.push(item);
        } catch (error) {
          errors.push({
            row: rowNumber,
            error: error.message,
            data: record
          });
        }
      }
    });

    // Handle parsing errors
    parser.on('error', (error) => {
      reject({
        success: false,
        error: 'CSV parsing failed: ' + error.message,
        errors
      });
    });

    // Handle completion
    parser.on('end', () => {
      if (errors.length > 0 && results.length === 0) {
        reject({
          success: false,
          error: 'CSV parsing failed with errors',
          errors,
          parsedCount: 0
        });
      } else {
        resolve({
          success: true,
          data: results,
          errors,
          parsedCount: results.length,
          totalRows: rowNumber - 1, // Exclude header row
          headers
        });
      }
    });

    // Pipe the stream through the parser
    stream.pipe(parser);
  });
}

// Validate CSV structure before parsing
export async function validateCSVStructure(fileBuffer, options = {}) {
  try {
    const firstLine = fileBuffer.toString('utf-8').split('\n')[0];
    const delimiter = options.delimiter || ',';
    const headers = firstLine.split(delimiter).map(h => h.trim());

    const validation = {
      valid: true,
      headers,
      missingColumns: [],
      warnings: []
    };

    // Check for required columns
    const requiredColumns = ['sku', 'unitPrice'];
    for (const required of requiredColumns) {
      const variations = COLUMN_MAPPINGS[required];
      const found = findColumnIndex(headers, variations) !== -1;
      if (!found) {
        validation.valid = false;
        validation.missingColumns.push({
          field: required,
          expectedNames: variations
        });
      }
    }

    // Check for recommended columns
    const recommendedColumns = ['description', 'currency', 'minimumOrderQuantity'];
    for (const recommended of recommendedColumns) {
      const variations = COLUMN_MAPPINGS[recommended];
      const found = findColumnIndex(headers, variations) !== -1;
      if (!found) {
        validation.warnings.push({
          field: recommended,
          message: `Recommended column not found. Expected one of: ${variations.join(', ')}`
        });
      }
    }

    return validation;
  } catch (error) {
    return {
      valid: false,
      error: 'Failed to validate CSV structure: ' + error.message
    };
  }
}

// Generate CSV template
export function generateCSVTemplate() {
  const headers = [
    'SKU',
    'Description',
    'Unit_Price',
    'Currency',
    'Minimum_Order_Quantity',
    'Unit_Of_Measure',
    'QTY_10',
    'PRICE_10',
    'QTY_50',
    'PRICE_50',
    'QTY_100',
    'PRICE_100'
  ];

  const sampleRows = [
    ['PROD-001', 'Widget A', '10.50', 'USD', '1', 'EA', '10', '9.50', '50', '8.75', '100', '8.00'],
    ['PROD-002', 'Widget B', '25.00', 'USD', '5', 'BOX', '10', '23.00', '50', '21.00', '100', '19.50'],
    ['PROD-003', 'Widget C', '5.75', 'USD', '1', 'EA', '', '', '', '', '', '']
  ];

  const csvContent = [
    headers.join(','),
    ...sampleRows.map(row => row.join(','))
  ].join('\n');

  return csvContent;
}