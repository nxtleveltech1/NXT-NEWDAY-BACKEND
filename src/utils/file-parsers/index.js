import { parseCSV, validateCSVStructure, generateCSVTemplate } from './csv-parser.js';
import { parseExcel, validateExcelStructure, generateExcelTemplate } from './excel-parser.js';
import { parseJSON, validateJSONStructure, generateJSONTemplate } from './json-parser.js';
import { parseXML, validateXMLStructure, generateXMLTemplate } from './xml-parser.js';
import { parsePDF, validatePDFStructure, generatePDFTemplate } from './pdf-parser.js';
<<<<<<< HEAD
=======
import { parseWord, validateWordStructure, generateWordTemplate } from './word-parser.js';
import { parseEmail, validateEmailStructure, generateEmailTemplate } from './email-parser.js';
import { parseIntelligentPDF, validateIntelligentPDFStructure, generateIntelligentPDFTemplate } from './intelligent-pdf-parser.js';
import { IntelligentColumnMapper } from './intelligent-column-mapper.js';
>>>>>>> 300aab3bb16173c33b69ac31996e9bb691d90580

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
    mimeTypes: ['application/json'],
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
<<<<<<< HEAD
=======
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
>>>>>>> 300aab3bb16173c33b69ac31996e9bb691d90580
  }
};

// Detect file type from filename or MIME type
export function detectFileType(filename, mimeType) {
  const extension = filename.toLowerCase().match(/\.[^.]+$/)?.[0];
  
  // Try to match by extension first
  for (const [type, config] of Object.entries(SUPPORTED_FILE_TYPES)) {
    if (extension && config.extensions.includes(extension)) {
      return type;
    }
  }
  
  // Fall back to MIME type
  if (mimeType) {
    for (const [type, config] of Object.entries(SUPPORTED_FILE_TYPES)) {
      if (config.mimeTypes.includes(mimeType)) {
        return type;
      }
    }
  }
  
  return null;
}

// Parse price list file
export async function parsePriceListFile(file, options = {}) {
  const { filename, mimeType, buffer } = file;
  
  // Detect file type
<<<<<<< HEAD
  const fileType = detectFileType(filename, mimeType);
=======
  let fileType = detectFileType(filename, mimeType);
  
  // For PDF files, check if intelligent parsing is requested
  if (fileType === 'PDF' && options.intelligentParsing !== false) {
    fileType = 'INTELLIGENT_PDF';
  }
>>>>>>> 300aab3bb16173c33b69ac31996e9bb691d90580
  
  if (!fileType) {
    return {
      success: false,
      error: `Unsupported file type. Filename: ${filename}, MIME: ${mimeType}`
    };
  }
  
  const config = SUPPORTED_FILE_TYPES[fileType];
  
  if (!config.parser) {
    return {
      success: false,
      error: `Parser not implemented for ${fileType} files`
    };
  }
  
  try {
<<<<<<< HEAD
    // Add file metadata to result
    const result = await config.parser(buffer, options);
    result.fileType = fileType;
    result.filename = filename;
    
=======
    // Enhanced options for intelligent parsing
    const enhancedOptions = {
      ...options,
      filename,
      intelligentMapping: options.intelligentMapping !== false,
      columnMapper: options.columnMapper || new IntelligentColumnMapper()
    };
    
    // Add file metadata to result
    const result = await config.parser(buffer, enhancedOptions);
    result.fileType = fileType;
    result.filename = filename;
    
    // Apply intelligent column mapping if available
    if (result.success && result.data && options.intelligentMapping !== false) {
      const mapper = enhancedOptions.columnMapper;
      
      // For array data with headers
      if (Array.isArray(result.data) && result.headers) {
        const mappingResult = mapper.mapHeaders(result.headers);
        result.mapping = mappingResult.mapping;
        result.mappingConfidence = mappingResult.confidence;
        result.unmappedHeaders = mappingResult.unmappedHeaders;
        
        // Apply mapping to data
        if (Object.keys(mappingResult.mapping).length > 0) {
          result.mappedData = mapper.applyMapping(result.data, mappingResult.mapping);
        }
      }
    }
    
>>>>>>> 300aab3bb16173c33b69ac31996e9bb691d90580
    return result;
  } catch (error) {
    return {
      success: false,
      error: `Failed to parse ${fileType} file: ${error.message}`,
      fileType,
      filename
    };
  }
}

// Validate price list file structure
export async function validatePriceListFile(file, options = {}) {
  const { filename, mimeType, buffer } = file;
  
  // Detect file type
  const fileType = detectFileType(filename, mimeType);
  
  if (!fileType) {
    return {
      valid: false,
      error: `Unsupported file type. Filename: ${filename}, MIME: ${mimeType}`
    };
  }
  
  const config = SUPPORTED_FILE_TYPES[fileType];
  
  if (!config.validator) {
    return {
      valid: false,
      error: `Validator not implemented for ${fileType} files`
    };
  }
  
  try {
    const result = await config.validator(buffer, options);
    result.fileType = fileType;
    result.filename = filename;
    
    return result;
  } catch (error) {
    return {
      valid: false,
      error: `Failed to validate ${fileType} file: ${error.message}`,
      fileType,
      filename
    };
  }
}

// Generate template file
export function generatePriceListTemplate(fileType) {
  const config = SUPPORTED_FILE_TYPES[fileType];
  
  if (!config) {
    throw new Error(`Invalid file type: ${fileType}`);
  }
  
  if (!config.templateGenerator) {
    throw new Error(`Template generator not implemented for ${fileType} files`);
  }
  
  return config.templateGenerator();
}

// Convert parsed data to standard format
export function standardizePriceListData(parsedData, supplierId, uploadedBy) {
  const { data, filename, fileType } = parsedData;
  
  // Create price list record
  const priceList = {
    supplierId,
    name: `Price List - ${new Date().toISOString().split('T')[0]}`,
    description: `Uploaded from ${filename}`,
    effectiveDate: new Date(),
    currency: 'USD', // Default, can be overridden by items
    status: 'pending',
    uploadedBy,
    sourceFile: {
      filename,
      fileType,
      uploadDate: new Date()
    }
  };
  
  // Standardize items
  const items = data.map(item => ({
    sku: item.sku.trim(),
    description: item.description || '',
    unitPrice: item.unitPrice,
    currency: item.currency || 'USD',
    minimumOrderQuantity: item.minimumOrderQuantity || 1,
    unitOfMeasure: item.unitOfMeasure || 'EA',
    tierPricing: item.tierPricing || [],
    isActive: true
  }));
  
  return {
    priceList,
    items
  };
}

// Import enhanced validation
import { validatePriceListData as enhancedValidate } from './validation.js';

// Enhanced price list data validation with business rules
export function validatePriceListData(priceList, items, options = {}) {
  // Use enhanced validation with business rules
  return enhancedValidate(priceList, items, {
    strictMode: options.strictMode || false,
    checkDuplicates: options.checkDuplicates !== false,
    validateBusinessRules: options.validateBusinessRules !== false,
    performanceCheck: options.performanceCheck !== false,
    ...options
  });
}