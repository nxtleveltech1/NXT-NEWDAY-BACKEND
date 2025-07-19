import * as XLSX from 'xlsx';

// Standard column mappings (same as CSV parser for consistency)
const COLUMN_MAPPINGS = {
  sku: ['sku', 'product_code', 'item_code', 'part_number', 'product_id', 'item_id'],
  description: ['description', 'product_description', 'item_description', 'name', 'product_name'],
  unitPrice: ['unit_price', 'price', 'cost', 'unit_cost', 'list_price'],
  currency: ['currency', 'currency_code', 'curr'],
  minimumOrderQuantity: ['moq', 'min_order_qty', 'minimum_order_quantity', 'min_qty'],
  unitOfMeasure: ['uom', 'unit_of_measure', 'unit', 'units']
};

// Find column index by trying different variations
function findColumnIndex(headers, columnVariations) {
  const normalizedHeaders = headers.map(h => 
    (h || '').toString().toLowerCase().trim().replace(/\s+/g, '_')
  );
  
  for (const variation of columnVariations) {
    const index = normalizedHeaders.indexOf(variation.toLowerCase());
    if (index !== -1) return index;
  }
  
  return -1;
}

// Convert Excel column letter to index (A=0, B=1, etc.)
function columnLetterToIndex(letter) {
  let index = 0;
  for (let i = 0; i < letter.length; i++) {
    index = index * 26 + letter.charCodeAt(i) - 'A'.charCodeAt(0) + 1;
  }
  return index - 1;
}

// Parse Excel buffer and extract price list data
export async function parseExcel(fileBuffer, options = {}) {
  const {
    sheetName = null, // Use first sheet if not specified
    headerRow = 1,
    skipEmptyRows = true
  } = options;

  try {
    // Read workbook from buffer
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    
    // Get sheet
    const sheet = sheetName 
      ? workbook.Sheets[sheetName] 
      : workbook.Sheets[workbook.SheetNames[0]];
    
    if (!sheet) {
      throw new Error(sheetName 
        ? `Sheet "${sheetName}" not found` 
        : 'No sheets found in workbook'
      );
    }

    // Convert sheet to JSON with header row
    const jsonData = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: '',
      blankrows: !skipEmptyRows
    });

    if (jsonData.length < headerRow) {
      throw new Error(`Header row ${headerRow} not found. File has ${jsonData.length} rows.`);
    }

    // Extract headers
    const headers = jsonData[headerRow - 1];
    if (!headers || headers.length === 0) {
      throw new Error('No headers found in the specified row');
    }

    // Map column names to indexes
    const columnIndexes = {};
    for (const [field, variations] of Object.entries(COLUMN_MAPPINGS)) {
      const index = findColumnIndex(headers, variations);
      if (index !== -1) {
        columnIndexes[field] = index;
      }
    }

    // Validate required columns
    const errors = [];
    if (columnIndexes.sku === undefined) {
      errors.push({
        row: headerRow,
        error: 'Required column "SKU" not found. Expected one of: ' + COLUMN_MAPPINGS.sku.join(', ')
      });
    }
    if (columnIndexes.unitPrice === undefined) {
      errors.push({
        row: headerRow,
        error: 'Required column "Unit Price" not found. Expected one of: ' + COLUMN_MAPPINGS.unitPrice.join(', ')
      });
    }

    // Parse data rows
    const results = [];
    for (let i = headerRow; i < jsonData.length; i++) {
      const row = jsonData[i];
      const rowNumber = i + 1;

      // Skip empty rows
      if (skipEmptyRows && (!row || row.every(cell => !cell || cell.toString().trim() === ''))) {
        continue;
      }

      try {
        // Extract data based on column mappings
        const item = {
          sku: row[columnIndexes.sku] || '',
          description: columnIndexes.description !== undefined ? row[columnIndexes.description] : '',
          unitPrice: parseFloat(row[columnIndexes.unitPrice]) || 0,
          currency: columnIndexes.currency !== undefined ? row[columnIndexes.currency] : 'USD',
          minimumOrderQuantity: columnIndexes.minimumOrderQuantity !== undefined 
            ? parseInt(row[columnIndexes.minimumOrderQuantity]) || 1 
            : 1,
          unitOfMeasure: columnIndexes.unitOfMeasure !== undefined 
            ? row[columnIndexes.unitOfMeasure] 
            : 'EA'
        };

        // Validate required fields
        if (!item.sku) {
          errors.push({
            row: rowNumber,
            error: 'SKU is required',
            data: row
          });
          continue;
        }

        if (isNaN(item.unitPrice) || item.unitPrice <= 0) {
          errors.push({
            row: rowNumber,
            error: 'Invalid unit price',
            data: row
          });
          continue;
        }

        // Look for tier pricing columns
        const tierPricing = [];
        for (let j = 0; j < headers.length; j++) {
          const header = (headers[j] || '').toString().toLowerCase();
          const qtyMatch = header.match(/qty[_\s]*(\d+)/);
          if (qtyMatch) {
            const tier = qtyMatch[1];
            const priceHeader = `price_${tier}`;
            const priceIndex = headers.findIndex(h => 
              (h || '').toString().toLowerCase().replace(/\s+/g, '_') === priceHeader
            );
            
            if (priceIndex !== -1 && row[j] && row[priceIndex]) {
              tierPricing.push({
                minQuantity: parseInt(row[j]),
                price: parseFloat(row[priceIndex])
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
          data: row
        });
      }
    }

    return {
      success: errors.length === 0 || results.length > 0,
      data: results,
      errors,
      parsedCount: results.length,
      totalRows: jsonData.length - headerRow,
      headers,
      sheetName: sheetName || workbook.SheetNames[0],
      availableSheets: workbook.SheetNames
    };
  } catch (error) {
    return {
      success: false,
      error: 'Excel parsing failed: ' + error.message,
      errors: [],
      parsedCount: 0
    };
  }
}

// Validate Excel structure before parsing
export async function validateExcelStructure(fileBuffer, options = {}) {
  try {
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    
    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      return {
        valid: false,
        error: 'No sheets found in workbook'
      };
    }

    const sheetName = options.sheetName || workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    
    if (!sheet) {
      return {
        valid: false,
        error: `Sheet "${sheetName}" not found`
      };
    }

    // Get headers from first row
    const jsonData = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      range: 0,
      raw: false
    });

    if (!jsonData || jsonData.length === 0) {
      return {
        valid: false,
        error: 'No data found in sheet'
      };
    }

    const headerRow = options.headerRow || 1;
    const headers = jsonData[headerRow - 1];

    if (!headers || headers.length === 0) {
      return {
        valid: false,
        error: `No headers found in row ${headerRow}`
      };
    }

    const validation = {
      valid: true,
      headers,
      missingColumns: [],
      warnings: [],
      sheetInfo: {
        name: sheetName,
        availableSheets: workbook.SheetNames,
        rowCount: jsonData.length,
        columnCount: headers.length
      }
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
      error: 'Failed to validate Excel structure: ' + error.message
    };
  }
}

// Generate Excel template
export function generateExcelTemplate() {
  // Create a new workbook
  const wb = XLSX.utils.book_new();

  // Create headers
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

  // Create sample data
  const data = [
    headers,
    ['PROD-001', 'Widget A', 10.50, 'USD', 1, 'EA', 10, 9.50, 50, 8.75, 100, 8.00],
    ['PROD-002', 'Widget B', 25.00, 'USD', 5, 'BOX', 10, 23.00, 50, 21.00, 100, 19.50],
    ['PROD-003', 'Widget C', 5.75, 'USD', 1, 'EA', '', '', '', '', '', '']
  ];

  // Create worksheet
  const ws = XLSX.utils.aoa_to_sheet(data);

  // Set column widths
  const colWidths = [
    { wch: 12 }, // SKU
    { wch: 30 }, // Description
    { wch: 12 }, // Unit_Price
    { wch: 10 }, // Currency
    { wch: 20 }, // Minimum_Order_Quantity
    { wch: 15 }, // Unit_Of_Measure
    { wch: 8 },  // QTY_10
    { wch: 10 }, // PRICE_10
    { wch: 8 },  // QTY_50
    { wch: 10 }, // PRICE_50
    { wch: 8 },  // QTY_100
    { wch: 10 }  // PRICE_100
  ];
  ws['!cols'] = colWidths;

  // Add worksheet to workbook
  XLSX.utils.book_append_sheet(wb, ws, 'Price List');

  // Add instructions sheet
  const instructionsData = [
    ['Price List Upload Instructions'],
    [''],
    ['Required Columns:'],
    ['- SKU: Product identifier (required)'],
    ['- Unit_Price: Base price per unit (required)'],
    [''],
    ['Optional Columns:'],
    ['- Description: Product description'],
    ['- Currency: Currency code (default: USD)'],
    ['- Minimum_Order_Quantity: Minimum quantity per order (default: 1)'],
    ['- Unit_Of_Measure: Unit of measure (default: EA)'],
    [''],
    ['Tier Pricing:'],
    ['- Use QTY_X and PRICE_X columns for quantity-based pricing'],
    ['- Example: QTY_10=10, PRICE_10=9.50 means price is $9.50 for 10+ units'],
    [''],
    ['Supported Formats:'],
    ['- Excel (.xlsx, .xls)'],
    ['- CSV (.csv)'],
    ['- JSON (.json)'],
    ['- XML (.xml)'],
    ['- PDF (structured tables only)']
  ];

  const wsInstructions = XLSX.utils.aoa_to_sheet(instructionsData);
  wsInstructions['!cols'] = [{ wch: 60 }];
  XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instructions');

  // Generate buffer
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// Get sheet names from Excel file
export async function getExcelSheetNames(fileBuffer) {
  try {
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    return {
      success: true,
      sheets: workbook.SheetNames
    };
  } catch (error) {
    return {
      success: false,
      error: 'Failed to read Excel file: ' + error.message
    };
  }
}