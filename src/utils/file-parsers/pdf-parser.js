// PDF parser for price list files
// Implements table extraction and structured data parsing

import { readFileSync } from 'fs';
import { join } from 'path';

// Mock implementation for pdf-parse (would be imported in real implementation)
// For development purposes, we'll simulate PDF parsing
const mockPdfParse = async (buffer) => {
  // Simulate PDF text extraction
  const text = `Price List Report
Supplier: Test Supplier Inc.
Effective Date: ${new Date().toISOString().split('T')[0]}

SKU          Description              Unit Price  Currency  MOQ  UOM
PROD-001     Widget A                 10.50       USD       1    EA
PROD-002     Widget B                 25.00       USD       5    BOX
PROD-003     Widget C                 5.75        USD       1    EA

Tier Pricing:
PROD-001: 10+ units = $9.50, 50+ units = $8.75, 100+ units = $8.00
PROD-002: 10+ units = $23.00, 50+ units = $21.00, 100+ units = $19.50

End of Report`;
  
  return { text };
};

// Table parsing patterns
const TABLE_PATTERNS = {
  // Pattern for standard table rows
  tableRow: /^([A-Z0-9-]+)\s+(.+?)\s+(\d+\.\d{2})\s+([A-Z]{3})\s+(\d+)\s+([A-Z]+)$/,
  // Pattern for header detection
  header: /(SKU|Product|Item).*(Price|Cost).*(Currency|Curr)/i,
  // Pattern for tier pricing
  tierPricing: /([A-Z0-9-]+):\s*(\d+)\+\s*units?\s*=\s*\$([\d.]+)/g
};

// Parse PDF buffer and extract price list data
export async function parsePDF(fileBuffer, options = {}) {
  const {
    extractionMethod = 'text', // 'text' or 'ocr'
    tableDetection = 'pattern', // 'pattern' or 'position'
    encoding = 'utf-8'
  } = options;

  try {
    // Extract text from PDF
    const pdfData = await mockPdfParse(fileBuffer);
    const text = pdfData.text;

    if (!text || text.trim().length === 0) {
      throw new Error('No text content found in PDF');
    }

    // Parse extracted text
    const parseResult = parseTextContent(text, options);
    
    return {
      success: parseResult.errors.length === 0 || parseResult.items.length > 0,
      data: parseResult.items,
      errors: parseResult.errors,
      parsedCount: parseResult.items.length,
      totalRows: parseResult.totalRows,
      extractedText: text,
      metadata: parseResult.metadata
    };
  } catch (error) {
    return {
      success: false,
      error: 'PDF parsing failed: ' + error.message,
      errors: [{
        error: error.message,
        type: 'parsing_error'
      }],
      parsedCount: 0
    };
  }
}

// Parse text content extracted from PDF
function parseTextContent(text, options = {}) {
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  const items = [];
  const errors = [];
  const metadata = {};
  let headerFound = false;
  let currentRow = 0;

  // Extract metadata from header
  for (const line of lines.slice(0, 10)) { // Check first 10 lines for metadata
    if (line.includes('Supplier:')) {
      metadata.supplierName = line.replace(/Supplier:\s*/, '').trim();
    }
    if (line.includes('Effective Date:')) {
      metadata.effectiveDate = line.replace(/Effective Date:\s*/, '').trim();
    }
    if (line.includes('Currency:')) {
      metadata.currency = line.replace(/Currency:\s*/, '').trim();
    }
  }

  // Find table data
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    currentRow = i + 1;

    // Check for header
    if (TABLE_PATTERNS.header.test(line)) {
      headerFound = true;
      continue;
    }

    // Skip lines before header is found
    if (!headerFound) continue;

    // Try to parse as table row
    const rowMatch = line.match(TABLE_PATTERNS.tableRow);
    if (rowMatch) {
      try {
        const [, sku, description, unitPrice, currency, moq, uom] = rowMatch;
        
        const item = {
          sku: sku.trim(),
          description: description.trim(),
          unitPrice: parseFloat(unitPrice),
          currency: currency.trim(),
          minimumOrderQuantity: parseInt(moq),
          unitOfMeasure: uom.trim(),
          tierPricing: []
        };

        // Validate item
        if (!item.sku) {
          errors.push({
            row: currentRow,
            error: 'SKU is required',
            data: line
          });
          continue;
        }

        if (isNaN(item.unitPrice) || item.unitPrice <= 0) {
          errors.push({
            row: currentRow,
            error: 'Invalid unit price',
            data: line
          });
          continue;
        }

        items.push(item);
      } catch (error) {
        errors.push({
          row: currentRow,
          error: 'Failed to parse table row: ' + error.message,
          data: line
        });
      }
    }
  }

  // Parse tier pricing from subsequent lines
  parseTierPricingFromText(text, items);

  return {
    items,
    errors,
    totalRows: lines.length,
    metadata
  };
}

// Parse tier pricing information from text
function parseTierPricingFromText(text, items) {
  const tierMatches = [...text.matchAll(TABLE_PATTERNS.tierPricing)];
  
  tierMatches.forEach(match => {
    const [, sku, minQuantity, price] = match;
    const item = items.find(i => i.sku === sku);
    
    if (item) {
      if (!item.tierPricing) {
        item.tierPricing = [];
      }
      
      item.tierPricing.push({
        minQuantity: parseInt(minQuantity),
        price: parseFloat(price)
      });
    }
  });

  // Sort tier pricing by quantity
  items.forEach(item => {
    if (item.tierPricing && item.tierPricing.length > 0) {
      item.tierPricing.sort((a, b) => a.minQuantity - b.minQuantity);
    }
  });
}

// Validate PDF structure before parsing
export async function validatePDFStructure(fileBuffer, options = {}) {
  try {
    // Check if buffer contains PDF header
    const header = fileBuffer.slice(0, 8).toString();
    if (!header.startsWith('%PDF-')) {
      return {
        valid: false,
        error: 'Invalid PDF file format'
      };
    }

    // Try to extract some text to validate structure
    const pdfData = await mockPdfParse(fileBuffer);
    const text = pdfData.text;

    if (!text || text.trim().length === 0) {
      return {
        valid: false,
        error: 'PDF appears to be empty or contains only images. Text-based PDFs are required.'
      };
    }

    // Check for table-like structure
    const lines = text.split('\n').filter(line => line.trim().length > 0);
    const hasTableHeader = lines.some(line => TABLE_PATTERNS.header.test(line));
    
    if (!hasTableHeader) {
      return {
        valid: false,
        error: 'No price list table found. PDF must contain structured table with SKU and Price columns.',
        warnings: ['Consider converting PDF to CSV or Excel format for better accuracy']
      };
    }

    // Count potential data rows
    const dataRows = lines.filter(line => TABLE_PATTERNS.tableRow.test(line));
    
    return {
      valid: true,
      estimatedItemCount: dataRows.length,
      warnings: dataRows.length === 0 
        ? ['Table structure found but no data rows detected. Please verify PDF format.']
        : []
    };
  } catch (error) {
    return {
      valid: false,
      error: 'Failed to validate PDF structure: ' + error.message
    };
  }
}

// Generate PDF template (placeholder - would require PDF generation library)
export function generatePDFTemplate() {
  // Return instructions for creating PDF templates
  const instructions = `
PDF Price List Template Instructions:

1. Create a PDF with the following table structure:

   SKU          Description              Unit Price  Currency  MOQ  UOM
   ----------   ----------------------   ----------  --------  ---  ---
   PROD-001     Widget A                 10.50       USD       1    EA
   PROD-002     Widget B                 25.00       USD       5    BOX
   PROD-003     Widget C                 5.75        USD       1    EA

2. Optional: Add tier pricing information after the table:

   Tier Pricing:
   PROD-001: 10+ units = $9.50, 50+ units = $8.75, 100+ units = $8.00
   PROD-002: 10+ units = $23.00, 50+ units = $21.00, 100+ units = $19.50

3. Ensure the PDF is text-based (not scanned images)
4. Use consistent spacing and alignment
5. Include metadata at the top (Supplier name, Effective date)

For best results, consider using CSV or Excel formats instead.
`;

  return instructions;
}

// Utility function to detect if PDF is text-based or image-based
export async function analyzePDF(fileBuffer) {
  try {
    const pdfData = await mockPdfParse(fileBuffer);
    const text = pdfData.text;
    
    return {
      hasText: text && text.trim().length > 0,
      textLength: text ? text.length : 0,
      isImageBased: !text || text.trim().length < 100, // Heuristic
      recommendedFormat: (!text || text.trim().length < 100) ? 'CSV or Excel' : 'PDF',
      estimatedPages: Math.ceil(text?.length / 3000) || 1 // Rough estimate
    };
  } catch (error) {
    return {
      hasText: false,
      textLength: 0,
      isImageBased: true,
      recommendedFormat: 'CSV or Excel',
      error: error.message
    };
  }
}

// Note: In a production environment, you would replace mockPdfParse with:
// import pdfParse from 'pdf-parse';
// const pdfData = await pdfParse(fileBuffer);