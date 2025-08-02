import { parseCSV, validateCSVStructure, generateCSVTemplate } from './csv-parser.js';
import { parseExcel, validateExcelStructure, generateExcelTemplate } from './excel-parser.js';
import { parseJSON, validateJSONStructure, generateJSONTemplate } from './json-parser.js';
import { parseXML, validateXMLStructure, generateXMLTemplate } from './xml-parser.js';
import { parsePDF, validatePDFStructure, generatePDFTemplate } from './pdf-parser.js';
import { parseWord, validateWordStructure, generateWordTemplate } from './word-parser.js';
import { parseEmail, validateEmailStructure, generateEmailTemplate } from './email-parser.js';
import { parseIntelligentPDF, validateIntelligentPDFStructure, generateIntelligentPDFTemplate } from './intelligent-pdf-parser.js';
import { IntelligentColumnMapper } from './intelligent-column-mapper.js';

// Supported file types
export const SUPPORTED_FILE_TYPES = {
  CSV: {
    extensions: ['.csv'],
    mimeTypes: ['text/csv', 'application/csv', 'text/plain'],
    parser: parseCSV,
    validator: validateCSVStructure,
    templateGenerator: generateCSVTemplate
  },
  EXCEL: {
    extensions: ['.xlsx', '.xls'],
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel'
    ],
    parser: parseExcel,
    validator: validateExcelStructure,
    templateGenerator: generateExcelTemplate
  },
  JSON: {
    extensions: ['.json'],
    mimeTypes: ['application/json', 'text/json'],
    parser: parseJSON,
    validator: validateJSONStructure,
    templateGenerator: generateJSONTemplate
  },
  XML: {
    extensions: ['.xml'],
    mimeTypes: ['application/xml', 'text/xml'],
    parser: parseXML,
    validator: validateXMLStructure,
    templateGenerator: generateXMLTemplate
  },
  PDF: {
    extensions: ['.pdf'],
    mimeTypes: ['application/pdf'],
    parser: parsePDF,
    validator: validatePDFStructure,
    templateGenerator: generatePDFTemplate
  },
  WORD: {
    extensions: ['.docx', '.doc'],
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword'
    ],
    parser: parseWord,
    validator: validateWordStructure,
    templateGenerator: generateWordTemplate
  },
  EMAIL: {
    extensions: ['.eml', '.msg'],
    mimeTypes: [
      'message/rfc822',
      'application/vnd.ms-outlook'
    ],
    parser: parseEmail,
    validator: validateEmailStructure,
    templateGenerator: generateEmailTemplate
  },
  INTELLIGENT_PDF: {
    extensions: ['.pdf'],
    mimeTypes: ['application/pdf'],
    parser: parseIntelligentPDF,
    validator: validateIntelligentPDFStructure,
    templateGenerator: generateIntelligentPDFTemplate,
    priority: 1 // Higher priority than regular PDF parser
  }
};

// Detect file type from filename or MIME type
export function detectFileType(filename, mimeType) {
  const extension = filename ? filename.toLowerCase().match(/\.[^.]+$/)?.[0] : null;
  
  // Try to match by extension first
  if (extension) {
    for (const [type, config] of Object.entries(SUPPORTED_FILE_TYPES)) {
      if (config.extensions.includes(extension)) {
        return type;
      }
    }
  }
  
  // Fall back to MIME type matching
  if (mimeType) {
    for (const [type, config] of Object.entries(SUPPORTED_FILE_TYPES)) {
      if (config.mimeTypes.includes(mimeType)) {
        return type;
      }
    }
  }
  
  return null;
}

// Get parser configuration for file type
export function getParserConfig(fileType) {
  return SUPPORTED_FILE_TYPES[fileType] || null;
}

// Main parsing function that delegates to appropriate parser
export async function parsePriceListFile(file, options = {}) {
  try {
    const fileType = detectFileType(file.originalname || file.name, file.mimetype);
    
    if (!fileType) {
      return {
        success: false,
        error: `Unsupported file type. Supported formats: ${Object.keys(SUPPORTED_FILE_TYPES).join(', ')}`
      };
    }
    
    const config = getParserConfig(fileType);
    if (!config) {
      return {
        success: false,
        error: `No parser configuration found for file type: ${fileType}`
      };
    }
    
    // Use the appropriate parser
    const result = await config.parser(file, options);
    
    if (result.success) {
      return {
        ...result,
        fileType,
        parserUsed: config.parser.name
      };
    }
    
    return result;
    
  } catch (error) {
    return {
      success: false,
      error: `File parsing failed: ${error.message}`,
      details: error.stack
    };
  }
}

// Main validation function
export async function validatePriceListFile(file, options = {}) {
  try {
    const fileType = detectFileType(file.originalname || file.name, file.mimetype);
    
    if (!fileType) {
      return {
        valid: false,
        error: `Unsupported file type. Supported formats: ${Object.keys(SUPPORTED_FILE_TYPES).join(', ')}`
      };
    }
    
    const config = getParserConfig(fileType);
    if (!config) {
      return {
        valid: false,
        error: `No validator configuration found for file type: ${fileType}`
      };
    }
    
    // Use the appropriate validator
    return await config.validator(file, options);
    
  } catch (error) {
    return {
      valid: false,
      error: `File validation failed: ${error.message}`,
      details: error.stack
    };
  }
}

// Template generation function
export async function generateTemplate(fileType, options = {}) {
  try {
    const config = getParserConfig(fileType);
    if (!config) {
      throw new Error(`No template generator found for file type: ${fileType}`);
    }
    
    return await config.templateGenerator(options);
    
  } catch (error) {
    return {
      success: false,
      error: `Template generation failed: ${error.message}`,
      details: error.stack
    };
  }
}

// Intelligent column mapping function
export async function applyIntelligentMapping(data, options = {}) {
  try {
    const mapper = new IntelligentColumnMapper(options);
    return await mapper.mapColumns(data);
  } catch (error) {
    return {
      success: false,
      error: `Intelligent mapping failed: ${error.message}`,
      suggestions: []
    };
  }
}

// Export all parsers for direct use if needed
export {
  parseCSV,
  parseExcel,
  parseJSON,
  parseXML,
  parsePDF,
  parseWord,
  parseEmail,
  parseIntelligentPDF,
  IntelligentColumnMapper
};

// Export validators
export {
  validateCSVStructure,
  validateExcelStructure,
  validateJSONStructure,
  validateXMLStructure,
  validatePDFStructure,
  validateWordStructure,
  validateEmailStructure,
  validateIntelligentPDFStructure
};

// Export template generators
export {
  generateCSVTemplate,
  generateExcelTemplate,
  generateJSONTemplate,
  generateXMLTemplate,
  generatePDFTemplate,
  generateWordTemplate,
  generateEmailTemplate,
  generateIntelligentPDFTemplate
};

// Export standardization function
export function standardizePriceListData(data, options = {}) {
  try {
    if (!Array.isArray(data)) {
      throw new Error('Data must be an array');
    }

    return data.map(item => ({
      sku: item.sku || item.SKU || item.productCode || item['Product Code'] || '',
      productName: item.productName || item['Product Name'] || item.name || item.Name || '',
      description: item.description || item.Description || item.productName || '',
      unitPrice: parseFloat(item.unitPrice || item['Unit Price'] || item.price || item.Price || 0),
      currency: item.currency || item.Currency || options.defaultCurrency || 'USD',
      category: item.category || item.Category || '',
      minimumOrderQuantity: parseInt(item.minimumOrderQuantity || item['Minimum Order Quantity'] || item.moq || item.MOQ || 1),
      leadTimeDays: parseInt(item.leadTimeDays || item['Lead Time Days'] || item.leadTime || 0),
      stockLevel: parseInt(item.stockLevel || item['Stock Level'] || item.stock || 0),
      unitOfMeasure: item.unitOfMeasure || item['Unit of Measure'] || item.uom || item.UOM || 'EA',
      // Preserve original data
      _original: item
    }));
  } catch (error) {
    throw new Error(`Data standardization failed: ${error.message}`);
  }
}

// Export validation function for price list data
export function validatePriceListData(data, options = {}) {
  try {
    if (!Array.isArray(data)) {
      return {
        valid: false,
        error: 'Data must be an array'
      };
    }

    const errors = [];
    const warnings = [];

    data.forEach((item, index) => {
      // Required field validation
      if (!item.sku) {
        errors.push(`Row ${index + 1}: SKU is required`);
      }

      if (!item.unitPrice || item.unitPrice <= 0) {
        errors.push(`Row ${index + 1}: Valid unit price is required`);
      }

      // Warnings for missing optional fields
      if (!item.productName && !item.description) {
        warnings.push(`Row ${index + 1}: Missing product name or description`);
      }
    });

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      totalItems: data.length,
      validItems: data.length - errors.length
    };
  } catch (error) {
    return {
      valid: false,
      error: `Validation failed: ${error.message}`
    };
  }
}