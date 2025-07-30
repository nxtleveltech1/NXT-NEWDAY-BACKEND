import { readFileSync } from 'fs';
import mammoth from 'mammoth';
import { parseStringPromise } from 'xml2js';
import AdmZip from 'adm-zip';

// Column mappings similar to CSV parser for consistency
const COLUMN_MAPPINGS = {
  sku: ['sku', 'product_code', 'item_code', 'part_number', 'product_id', 'item_id', 'item #', 'item_no'],
  description: ['description', 'product_description', 'item_description', 'name', 'product_name', 'item'],
  unitPrice: ['unit_price', 'price', 'cost', 'unit_cost', 'list_price', 'unit price', 'price/unit'],
  currency: ['currency', 'currency_code', 'curr', 'ccy'],
  minimumOrderQuantity: ['moq', 'min_order_qty', 'minimum_order_quantity', 'min_qty', 'min qty', 'minimum'],
  unitOfMeasure: ['uom', 'unit_of_measure', 'unit', 'units', 'measure']
};

// Parse Word document (.docx) and extract price list data
export async function parseWord(fileBuffer, options = {}) {
  const {
    extractTables = true,
    extractText = true,
    intelligentParsing = true
  } = options;

  try {
    // Extract raw HTML and text from Word document
    const result = await mammoth.convertToHtml({
      buffer: fileBuffer,
      options: {
        convertImage: mammoth.images.imgElement(function(image) {
          return image.read("base64").then(function(imageBuffer) {
            return {
              src: "data:" + image.contentType + ";base64," + imageBuffer
            };
          });
        })
      }
    });

    const html = result.value;
    const messages = result.messages;

    // Also extract plain text for fallback parsing
    const textResult = await mammoth.extractRawText({ buffer: fileBuffer });
    const plainText = textResult.value;

    // Parse tables from HTML
    let items = [];
    let errors = [];
    let metadata = {};

    if (extractTables) {
      const tableResult = await parseTablesFromHtml(html, options);
      items = tableResult.items;
      errors = tableResult.errors;
      metadata = tableResult.metadata;
    }

    // If no tables found or insufficient data, try intelligent text parsing
    if (items.length === 0 && extractText && intelligentParsing) {
      const textResult = await parseTextContent(plainText, options);
      items = textResult.items;
      errors = [...errors, ...textResult.errors];
      metadata = { ...metadata, ...textResult.metadata };
    }

    // Extract metadata from document properties
    const docMetadata = await extractDocumentMetadata(fileBuffer);
    metadata = { ...metadata, ...docMetadata };

    return {
      success: items.length > 0 || errors.length === 0,
      data: items,
      errors,
      parsedCount: items.length,
      metadata,
      rawText: plainText,
      messages
    };
  } catch (error) {
    return {
      success: false,
      error: 'Word parsing failed: ' + error.message,
      errors: [{
        error: error.message,
        type: 'parsing_error'
      }],
      parsedCount: 0
    };
  }
}

// Parse tables from HTML content
async function parseTablesFromHtml(html, options = {}) {
  const items = [];
  const errors = [];
  const metadata = {};

  // Use regex to find all tables in HTML
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  const tables = html.match(tableRegex) || [];

  for (let tableIndex = 0; tableIndex < tables.length; tableIndex++) {
    const table = tables[tableIndex];
    
    // Extract rows
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const rows = table.match(rowRegex) || [];
    
    if (rows.length === 0) continue;

    // Parse header row
    let headers = [];
    let dataStartRow = 0;
    
    for (let i = 0; i < Math.min(3, rows.length); i++) {
      const cellRegex = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
      const cells = rows[i].match(cellRegex) || [];
      const cellTexts = cells.map(cell => 
        cell.replace(/<[^>]*>/g, '').trim()
      );
      
      // Check if this row contains headers
      if (isHeaderRow(cellTexts)) {
        headers = cellTexts;
        dataStartRow = i + 1;
        break;
      }
    }

    if (headers.length === 0) continue;

    // Map column indices
    const columnIndexes = mapColumnIndices(headers);
    
    // Parse data rows
    for (let i = dataStartRow; i < rows.length; i++) {
      const cellRegex = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
      const cells = rows[i].match(cellRegex) || [];
      const cellTexts = cells.map(cell => 
        cell.replace(/<[^>]*>/g, '').trim()
      );

      // Skip empty rows
      if (cellTexts.every(text => !text)) continue;

      try {
        const item = extractItemFromRow(cellTexts, columnIndexes);
        
        if (item && item.sku && !isNaN(item.unitPrice) && item.unitPrice > 0) {
          items.push(item);
        } else if (item && item.sku) {
          errors.push({
            row: i + 1,
            table: tableIndex + 1,
            error: 'Invalid price or missing required data',
            data: cellTexts
          });
        }
      } catch (error) {
        errors.push({
          row: i + 1,
          table: tableIndex + 1,
          error: error.message,
          data: cellTexts
        });
      }
    }
  }

  // Extract supplier info from document
  const supplierMatch = html.match(/supplier[:\s]+([^<\n]+)/i);
  if (supplierMatch) {
    metadata.supplierName = supplierMatch[1].trim();
  }

  return { items, errors, metadata };
}

// Parse text content using intelligent patterns
async function parseTextContent(text, options = {}) {
  const items = [];
  const errors = [];
  const metadata = {};
  
  // Split into lines
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line);
  
  // Look for patterns that indicate price list data
  const patterns = {
    // Pattern: SKU | Description | Price | Currency | MOQ | UOM
    tabular: /^([A-Z0-9\-]+)\s*[\|\t]\s*(.+?)\s*[\|\t]\s*([\d,]+\.?\d*)\s*[\|\t]?\s*([A-Z]{3})?\s*[\|\t]?\s*(\d+)?\s*[\|\t]?\s*([A-Z]+)?$/i,
    // Pattern: SKU: ABC123, Description: Widget, Price: $10.50
    labeled: /SKU:\s*([A-Z0-9\-]+).*?(?:Description|Name):\s*(.+?).*?Price:\s*\$?([\d,]+\.?\d*)/i,
    // Pattern: ABC123 - Widget - $10.50
    dashed: /^([A-Z0-9\-]+)\s*[-–]\s*(.+?)\s*[-–]\s*\$?([\d,]+\.?\d*)$/i
  };

  let currentSection = 'unknown';
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Check if this is a section header
    if (line.toLowerCase().includes('price list') || 
        line.toLowerCase().includes('product list') ||
        line.toLowerCase().includes('catalog')) {
      currentSection = 'price_list';
      continue;
    }
    
    // Extract metadata
    if (line.includes('Supplier:') || line.includes('Vendor:')) {
      metadata.supplierName = line.split(':')[1]?.trim();
      continue;
    }
    
    if (line.includes('Effective Date:') || line.includes('Valid From:')) {
      metadata.effectiveDate = line.split(':')[1]?.trim();
      continue;
    }
    
    // Skip obvious non-data lines
    if (line.length < 5 || 
        line.toLowerCase().includes('page') ||
        line.toLowerCase().includes('confidential')) {
      continue;
    }
    
    // Try each pattern
    let matched = false;
    
    // Tabular pattern
    let match = line.match(patterns.tabular);
    if (match) {
      const [, sku, description, price, currency, moq, uom] = match;
      items.push({
        sku: sku.trim(),
        description: description.trim(),
        unitPrice: parseFloat(price.replace(/,/g, '')),
        currency: currency || 'USD',
        minimumOrderQuantity: moq ? parseInt(moq) : 1,
        unitOfMeasure: uom || 'EA'
      });
      matched = true;
    }
    
    // Labeled pattern
    if (!matched) {
      match = line.match(patterns.labeled);
      if (match) {
        const [, sku, description, price] = match;
        items.push({
          sku: sku.trim(),
          description: description.trim(),
          unitPrice: parseFloat(price.replace(/,/g, '')),
          currency: 'USD',
          minimumOrderQuantity: 1,
          unitOfMeasure: 'EA'
        });
        matched = true;
      }
    }
    
    // Dashed pattern
    if (!matched) {
      match = line.match(patterns.dashed);
      if (match) {
        const [, sku, description, price] = match;
        items.push({
          sku: sku.trim(),
          description: description.trim(),
          unitPrice: parseFloat(price.replace(/,/g, '')),
          currency: 'USD',
          minimumOrderQuantity: 1,
          unitOfMeasure: 'EA'
        });
        matched = true;
      }
    }
    
    // If in price list section but no match, it might be an error
    if (!matched && currentSection === 'price_list' && line.length > 10) {
      // Check if line contains potential SKU pattern
      const skuPattern = /\b[A-Z0-9]{3,}[-_]?[A-Z0-9]+\b/;
      if (skuPattern.test(line)) {
        errors.push({
          line: i + 1,
          error: 'Could not parse price list entry',
          data: line
        });
      }
    }
  }
  
  // Look for tier pricing information
  const tierPricingSection = text.match(/tier\s*pricing[\s\S]*?(?=\n\n|\n[A-Z]|$)/i);
  if (tierPricingSection) {
    parseTierPricing(tierPricingSection[0], items);
  }
  
  return { items, errors, metadata };
}

// Check if row contains headers
function isHeaderRow(cells) {
  if (cells.length < 2) return false;
  
  const headerKeywords = ['sku', 'product', 'item', 'code', 'description', 'name', 
                          'price', 'cost', 'currency', 'qty', 'quantity', 'uom', 'unit'];
  
  let matchCount = 0;
  for (const cell of cells) {
    const cellLower = cell.toLowerCase();
    if (headerKeywords.some(keyword => cellLower.includes(keyword))) {
      matchCount++;
    }
  }
  
  return matchCount >= 2; // At least 2 header keywords found
}

// Map column indices based on headers
function mapColumnIndices(headers) {
  const columnIndexes = {};
  
  for (const [field, variations] of Object.entries(COLUMN_MAPPINGS)) {
    for (let i = 0; i < headers.length; i++) {
      const headerLower = headers[i].toLowerCase().trim();
      
      if (variations.some(v => headerLower.includes(v) || v.includes(headerLower))) {
        columnIndexes[field] = i;
        break;
      }
    }
  }
  
  return columnIndexes;
}

// Extract item from row based on column mapping
function extractItemFromRow(cells, columnIndexes) {
  const item = {
    sku: cells[columnIndexes.sku] || '',
    description: cells[columnIndexes.description] || '',
    unitPrice: 0,
    currency: 'USD',
    minimumOrderQuantity: 1,
    unitOfMeasure: 'EA'
  };
  
  // Parse unit price
  if (columnIndexes.unitPrice !== undefined && cells[columnIndexes.unitPrice]) {
    const priceText = cells[columnIndexes.unitPrice];
    const priceMatch = priceText.match(/[\d,]+\.?\d*/);
    if (priceMatch) {
      item.unitPrice = parseFloat(priceMatch[0].replace(/,/g, ''));
    }
  }
  
  // Parse currency
  if (columnIndexes.currency !== undefined && cells[columnIndexes.currency]) {
    item.currency = cells[columnIndexes.currency].toUpperCase();
  }
  
  // Parse MOQ
  if (columnIndexes.minimumOrderQuantity !== undefined && cells[columnIndexes.minimumOrderQuantity]) {
    const moqMatch = cells[columnIndexes.minimumOrderQuantity].match(/\d+/);
    if (moqMatch) {
      item.minimumOrderQuantity = parseInt(moqMatch[0]);
    }
  }
  
  // Parse UOM
  if (columnIndexes.unitOfMeasure !== undefined && cells[columnIndexes.unitOfMeasure]) {
    item.unitOfMeasure = cells[columnIndexes.unitOfMeasure].toUpperCase();
  }
  
  return item;
}

// Parse tier pricing information
function parseTierPricing(text, items) {
  // Pattern: SKU: 10+ = $9.50, 50+ = $8.75
  const tierPattern = /([A-Z0-9\-]+)[:\s]+(?:(\d+)\+\s*=\s*\$?([\d.]+)[\s,]*)+/gi;
  const matches = text.matchAll(tierPattern);
  
  for (const match of matches) {
    const sku = match[1];
    const item = items.find(i => i.sku === sku);
    
    if (item) {
      item.tierPricing = item.tierPricing || [];
      
      // Extract all tier levels from the match
      const tierText = match[0];
      const tierLevels = tierText.matchAll(/(\d+)\+\s*=\s*\$?([\d.]+)/g);
      
      for (const tier of tierLevels) {
        item.tierPricing.push({
          minQuantity: parseInt(tier[1]),
          price: parseFloat(tier[2])
        });
      }
      
      // Sort by quantity
      item.tierPricing.sort((a, b) => a.minQuantity - b.minQuantity);
    }
  }
}

// Extract metadata from document (DOCX specific)
async function extractDocumentMetadata(fileBuffer) {
  const metadata = {};
  
  try {
    // DOCX files are ZIP archives
    const zip = new AdmZip(fileBuffer);
    const docPropsEntry = zip.getEntry('docProps/core.xml');
    
    if (docPropsEntry) {
      const xmlContent = zip.readAsText(docPropsEntry);
      const parsed = await parseStringPromise(xmlContent);
      
      const coreProps = parsed['cp:coreProperties'] || parsed.coreProperties;
      if (coreProps) {
        metadata.title = coreProps['dc:title']?.[0] || coreProps.title?.[0];
        metadata.creator = coreProps['dc:creator']?.[0] || coreProps.creator?.[0];
        metadata.created = coreProps['dcterms:created']?.[0] || coreProps.created?.[0];
        metadata.modified = coreProps['dcterms:modified']?.[0] || coreProps.modified?.[0];
      }
    }
  } catch (error) {
    // Silently fail metadata extraction
  }
  
  return metadata;
}

// Validate Word document structure
export async function validateWordStructure(fileBuffer, options = {}) {
  try {
    // Try to convert to HTML to verify it's a valid Word document
    const result = await mammoth.convertToHtml({ buffer: fileBuffer });
    
    if (result.messages.some(m => m.type === 'error')) {
      return {
        valid: false,
        error: 'Invalid Word document format',
        messages: result.messages
      };
    }
    
    const html = result.value;
    
    // Check for tables
    const hasTables = /<table/i.test(html);
    
    // Check for potential price list content
    const textResult = await mammoth.extractRawText({ buffer: fileBuffer });
    const text = textResult.value.toLowerCase();
    
    const hasPriceIndicators = /price|cost|sku|product|item/i.test(text);
    const hasNumericData = /\d+\.\d{2}/.test(text); // Prices like 10.50
    
    const warnings = [];
    if (!hasTables) {
      warnings.push('No tables found. Document may use text-based formatting.');
    }
    
    if (!hasPriceIndicators) {
      warnings.push('No price-related keywords found. Please verify document contains price list data.');
    }
    
    if (!hasNumericData) {
      warnings.push('No numeric price data detected.');
    }
    
    return {
      valid: true,
      hasTables,
      hasPriceData: hasPriceIndicators && hasNumericData,
      warnings,
      documentInfo: {
        wordCount: text.split(/\s+/).length,
        hasImages: /<img/i.test(html),
        tableCount: (html.match(/<table/gi) || []).length
      }
    };
  } catch (error) {
    return {
      valid: false,
      error: 'Failed to validate Word document: ' + error.message
    };
  }
}

// Generate Word template instructions
export function generateWordTemplate() {
  return `
Word Document Price List Template Instructions:

1. Create a new Word document (.docx)

2. Add a header with supplier information:
   Supplier: Your Company Name
   Effective Date: ${new Date().toISOString().split('T')[0]}
   Currency: USD

3. Create a table with the following columns:
   | SKU | Description | Unit Price | Currency | MOQ | UOM |
   |-----|-------------|------------|----------|-----|-----|
   | PROD-001 | Widget A | 10.50 | USD | 1 | EA |
   | PROD-002 | Widget B | 25.00 | USD | 5 | BOX |
   | PROD-003 | Widget C | 5.75 | USD | 1 | EA |

4. Optional: Add tier pricing section after the table:
   Tier Pricing:
   PROD-001: 10+ = $9.50, 50+ = $8.75, 100+ = $8.00
   PROD-002: 10+ = $23.00, 50+ = $21.00, 100+ = $19.50

5. Tips for best results:
   - Use clear table formatting with borders
   - Keep column headers simple and standard
   - Use consistent number formatting (e.g., 10.50 not 10.5)
   - Avoid merged cells or complex formatting
   - Save as .docx (not .doc) for best compatibility

6. Alternative text-based format:
   If not using tables, structure data clearly:
   
   SKU: PROD-001 | Description: Widget A | Price: $10.50 | MOQ: 1 | UOM: EA
   SKU: PROD-002 | Description: Widget B | Price: $25.00 | MOQ: 5 | UOM: BOX
   
   Or use a consistent delimiter like tabs or pipes (|).
`;
}